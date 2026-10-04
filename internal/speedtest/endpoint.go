package speedtest

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/iperfres"
	"diteng-pannel/internal/sshd"

	"github.com/pkg/sftp"
)

// LocalID 「本机」端点的保留 ID（SSH 别名不会是这个）
const LocalID = "@local"

// endpoint 测速的一端：本机或 SSH 主机
type endpoint interface {
	id() string
	label() string
	local() bool
	linux() bool
	provision(ctx context.Context) error
	addrs(ctx context.Context) ([]Addr, error)
	// iperfOnce 跑一次 iperf3 并取全部输出（探测用）
	iperfOnce(ctx context.Context, args []string, timeout time.Duration) ([]byte, error)
	// iperfStream 跑 iperf3 客户端，stdout 逐行回调
	iperfStream(ctx context.Context, args []string, maxDur time.Duration, onLine func(string)) error
	// startServer 后台起 iperf3 -s；port 为 0 时在 5201–5210 里找空闲端口
	startServer(ctx context.Context, port int, maxDur time.Duration) (int, string, error)
	stopServer(handle string)
	// ping 平均 RTT（毫秒），不可用时为 0
	ping(ctx context.Context, ip string) float64
}

var (
	rePingAvgPosix = regexp.MustCompile(`=\s*[\d.]+/([\d.]+)/`)
	rePingAvgWin   = regexp.MustCompile(`=\s*(\d+)\s*ms`)
)

func parsePingAvg(out string) float64 {
	if m := rePingAvgPosix.FindStringSubmatch(out); m != nil {
		v, _ := strconv.ParseFloat(m[1], 64)
		return v
	}
	// Windows 汇总行为「Minimum = 1ms, Maximum = 3ms, Average = 2ms」（中文系统为 GBK 乱码），
	// 不依赖文字标签，取最后一个值即平均
	if all := rePingAvgWin.FindAllStringSubmatch(out, -1); len(all) > 0 {
		v, _ := strconv.ParseFloat(all[len(all)-1][1], 64)
		return v
	}
	return 0
}

// ===== 远端（SSH） =====

const remoteDir = ".cache/1panel"

func remoteBinName() string { return "iperf3-" + iperfres.Version }

// 远端 shell 中的二进制路径（双引号内展开 $HOME）
func remoteBinShell() string { return `"$HOME/` + remoteDir + "/" + remoteBinName() + `"` }

type remoteEP struct {
	svc  *Service
	host string
	opt  sshd.ConnectOption
	goos string
}

func (r *remoteEP) id() string    { return r.host }
func (r *remoteEP) label() string { return r.host }
func (r *remoteEP) local() bool   { return false }
func (r *remoteEP) linux() bool   { return r.goos != "darwin" }

// posix 远端登录 shell 可能是 zsh / fish，脚本统一交给 sh 执行
func posix(script string) string { return "sh -c " + shellQuote(script) }

func (r *remoteEP) run(cmd string, timeout time.Duration) ([]byte, error) {
	return r.svc.mgr.Run(r.host, r.opt, posix(cmd), sshd.RunOptions{Timeout: timeout})
}

func (r *remoteEP) provision(ctx context.Context) error {
	key := r.host + "|" + r.opt.HostName
	if r.svc.provisioned(key, &r.goos) {
		return nil
	}
	out, err := r.run(`uname -s; uname -m; f=`+remoteBinShell()+`; if [ -x "$f" ]; then (sha256sum "$f" 2>/dev/null || shasum -a 256 "$f" 2>/dev/null) | awk '{print $1}'; else echo none; fi`, 15*time.Second)
	if err != nil {
		return fmt.Errorf("%s：探测系统失败：%v", r.host, err)
	}
	lines := strings.Fields(string(out))
	if len(lines) < 2 {
		return fmt.Errorf("%s：无法识别系统架构：%s", r.host, strings.TrimSpace(string(out)))
	}
	r.goos = strings.ToLower(lines[0])
	bin, want, err := iperfres.Binary(r.goos, lines[1])
	if err != nil {
		return fmt.Errorf("%s：%v", r.host, err)
	}
	if len(lines) < 3 || lines[2] != want {
		r.svc.emitState("", PhaseProvision, fmt.Sprintf("上传 iperf3 到 %s", r.host))
		if err := r.upload(bin); err != nil {
			return fmt.Errorf("%s：上传 iperf3 失败：%v", r.host, err)
		}
	}
	r.svc.markProvisioned(key, r.goos)
	return nil
}

func (r *remoteEP) upload(bin []byte) error {
	client, err := r.svc.mgr.GetClient(r.host, r.opt)
	if err != nil {
		return err
	}
	sc, err := sftp.NewClient(client)
	if err != nil {
		return fmt.Errorf("建立 sftp 通道失败: %w", err)
	}
	defer sc.Close()
	if err := sc.MkdirAll(remoteDir); err != nil {
		return err
	}
	tmp := remoteDir + "/" + remoteBinName() + ".tmp"
	f, err := sc.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := f.Write(bin); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Chmod(0o755); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	_ = sc.Remove(remoteDir + "/" + remoteBinName())
	return sc.Rename(tmp, remoteDir+"/"+remoteBinName())
}

func (r *remoteEP) addrs(ctx context.Context) ([]Addr, error) {
	out, err := r.run(`ip -o -4 addr show 2>/dev/null; echo "=EGRESS="; `+egressScript, 15*time.Second)
	if err != nil {
		return nil, fmt.Errorf("%s：读取网卡失败：%v", r.host, err)
	}
	text := string(out)
	egress := ""
	if i := strings.Index(text, "=EGRESS="); i >= 0 {
		egress = parseEgress(text[i:])
		text = text[:i]
	}
	addrs := parseIPAddr(text)
	addrs = addHostName(addrs, resolveHost(ctx, r.opt.HostName, r.host))
	return addEgress(addrs, egress), nil
}

// egressScript 查出口 IPv4：绕过代理（代理出口对入站测速没有意义），
// 偶发返回 IPv6 时最多重试 3 次，直到拿到 IPv4
const egressScript = `for i in 1 2 3; do
o=$( (curl -4 -sL --noproxy "*" --max-time 2 https://myip.ipip.net/ 2>/dev/null || wget -qO- --no-proxy -T 2 https://myip.ipip.net/ 2>/dev/null) | head -c 400)
echo "$o"
echo "$o" | grep -Eq "[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+" && break
done; true`

func resolveHost(ctx context.Context, hostName, alias string) []net.IP {
	h := strings.TrimSpace(hostName)
	if h == "" {
		h = alias
	}
	if ip := net.ParseIP(h); ip != nil {
		return []net.IP{ip}
	}
	cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIP(cctx, "ip4", h)
	if err != nil {
		return nil
	}
	return ips
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

func quoteArgs(args []string) string {
	q := make([]string, len(args))
	for i, a := range args {
		q[i] = shellQuote(a)
	}
	return strings.Join(q, " ")
}

// withTimeout 有 timeout 命令时给远端进程加硬上限，防止 SSH 断开后残留
func withTimeout(secs int, cmd string) string {
	return fmt.Sprintf(`if command -v timeout >/dev/null 2>&1; then exec timeout %d %s; else exec %s; fi`, secs, cmd, cmd)
}

func (r *remoteEP) iperfOnce(ctx context.Context, args []string, timeout time.Duration) ([]byte, error) {
	cmd := withTimeout(int(timeout.Seconds())+1, remoteBinShell()+" "+quoteArgs(args))
	return r.run(cmd, timeout+3*time.Second)
}

func (r *remoteEP) iperfStream(ctx context.Context, args []string, maxDur time.Duration, onLine func(string)) error {
	cmd := withTimeout(int(maxDur.Seconds()), remoteBinShell()+" "+quoteArgs(args))
	return r.svc.mgr.RunStream(ctx, r.host, r.opt, posix(cmd), onLine)
}

func (r *remoteEP) startServer(ctx context.Context, port int, maxDur time.Duration) (int, string, error) {
	ports := []int{port}
	if port == 0 {
		ports = nil
		for p := 5201; p <= 5210; p++ {
			ports = append(ports, p)
		}
	}
	plist := make([]string, len(ports))
	for i, p := range ports {
		plist[i] = strconv.Itoa(p)
	}
	secs := int(maxDur.Seconds())
	// 用 timeout 包住服务端：杀 timeout 进程时它会把 SIGTERM 转给 iperf3；SSH 断开也最多存活 secs 秒
	script := fmt.Sprintf(`B=%s
T=""; command -v timeout >/dev/null 2>&1 && T="timeout %d"
for p in %s; do
  nohup $T "$B" -s -p "$p" >/dev/null 2>&1 </dev/null &
  pid=$!
  sleep 0.4
  if kill -0 "$pid" 2>/dev/null; then echo "OK $p $pid"; exit 0; fi
done
echo FAIL`, remoteBinShell(), secs, strings.Join(plist, " "))
	out, err := r.run(script, 20*time.Second)
	text := strings.TrimSpace(string(out))
	if err != nil {
		return 0, "", fmt.Errorf("%v %s", err, text)
	}
	f := strings.Fields(lastLine(text))
	if len(f) != 3 || f[0] != "OK" {
		return 0, "", fmt.Errorf("端口 %s 均被占用或无法监听", strings.Join(plist, "/"))
	}
	p, _ := strconv.Atoi(f[1])
	return p, f[2], nil
}

func (r *remoteEP) stopServer(handle string) {
	if _, err := strconv.Atoi(handle); err != nil {
		return
	}
	_, _ = r.run("kill "+handle+" 2>/dev/null; true", 10*time.Second)
}

func (r *remoteEP) ping(ctx context.Context, ip string) float64 {
	out, _ := r.run("ping -c 3 -i 0.2 -W 1 -q "+shellQuote(ip)+" 2>/dev/null | tail -1", 8*time.Second)
	return parsePingAvg(string(out))
}

func lastLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndexByte(s, '\n'); i >= 0 {
		return s[i+1:]
	}
	return s
}

// ===== 本机 =====

type localEP struct {
	svc *Service
	bin string
}

func (l *localEP) id() string    { return LocalID }
func (l *localEP) label() string { return "本机" }
func (l *localEP) local() bool   { return true }
func (l *localEP) linux() bool   { return runtime.GOOS == "linux" }

func (l *localEP) provision(ctx context.Context) error {
	fl, err := iperfres.Files(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}
	// 版本化目录，升级内置 iperf3 后自动失效重写；Windows 的 exe 与 cygwin1.dll 须同目录
	dir := filepath.Join(l.svc.dataDir, "iperf3", iperfres.Version)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	reuse := true
	for _, f := range fl {
		b, err := os.ReadFile(filepath.Join(dir, f.Name))
		if err != nil {
			reuse = false
			break
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != f.SHA256 {
			reuse = false
			break
		}
	}
	if !reuse {
		for _, f := range fl {
			dst := filepath.Join(dir, f.Name)
			tmp := dst + ".tmp"
			if err := os.WriteFile(tmp, f.Data, 0o755); err != nil {
				return err
			}
			_ = os.Remove(dst)
			if err := os.Rename(tmp, dst); err != nil {
				return err
			}
		}
	}
	l.bin = filepath.Join(dir, fl[0].Name)
	return nil
}

func (l *localEP) addrs(ctx context.Context) ([]Addr, error) {
	return addEgress(localAddrs(), localEgress(ctx)), nil
}

var localEgressCache struct {
	sync.Mutex
	ip   string
	next time.Time
}

func localEgress(ctx context.Context) string {
	c := &localEgressCache
	c.Lock()
	defer c.Unlock()
	if time.Now().Before(c.next) {
		return c.ip
	}
	c.next = time.Now().Add(time.Minute)
	for i := 0; i < 3; i++ {
		if ip := fetchEgress4(ctx); ip != "" {
			c.ip, c.next = ip, time.Now().Add(10*time.Minute)
			break
		}
	}
	return c.ip
}

// egressClient 只走 IPv4 直连，避免拿到 IPv6 或代理的出口
var egressClient = &http.Client{Transport: &http.Transport{
	Proxy: nil,
	DialContext: func(ctx context.Context, _, addr string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp4", addr)
	},
}}

func fetchEgress4(ctx context.Context) string {
	cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(cctx, http.MethodGet, "https://myip.ipip.net/", nil)
	resp, err := egressClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	return parseEgress(string(body))
}

func (l *localEP) iperfOnce(ctx context.Context, args []string, timeout time.Duration) ([]byte, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, err := exec.CommandContext(cctx, l.bin, args...).CombinedOutput()
	if cctx.Err() != nil {
		return nil, errProbeTimeout
	}
	if len(bytes.TrimSpace(out)) > 0 {
		return out, nil
	}
	return out, err
}

func (l *localEP) iperfStream(ctx context.Context, args []string, maxDur time.Duration, onLine func(string)) error {
	cctx, cancel := context.WithTimeout(ctx, maxDur)
	defer cancel()
	cmd := exec.CommandContext(cctx, l.bin, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		onLine(sc.Text())
	}
	err = cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil && stderr.Len() > 0 {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return err
}

func (l *localEP) startServer(ctx context.Context, port int, maxDur time.Duration) (int, string, error) {
	return 0, "", fmt.Errorf("本机固定作为客户端，不启动服务端")
}

func (l *localEP) stopServer(string) {}

func (l *localEP) ping(ctx context.Context, ip string) float64 {
	cctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	var out []byte
	if runtime.GOOS == "windows" {
		// Windows ping 参数与输出均不同：-n 次数、-w 毫秒超时，汇总行为「Average = 1ms / 平均 = 1ms」
		out, _ = exec.CommandContext(cctx, "ping", "-n", "3", "-w", "1000", ip).Output()
	} else {
		args := []string{"-c", "3", "-i", "0.2", "-q", ip}
		if runtime.GOOS == "darwin" {
			args = append([]string{"-t", "3"}, args...)
		} else {
			args = append([]string{"-W", "1"}, args...)
		}
		out, _ = exec.CommandContext(cctx, "ping", args...).Output()
	}
	return parsePingAvg(string(out))
}
