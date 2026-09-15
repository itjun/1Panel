// Package agentinstall 面板侧的 spanel-agent 安装/更新/卸载。
// 全部经既有 SSH 通道完成（sftp 传二进制 + 一次性管理命令），与数据面（agent HTTP）解耦。
package agentinstall

import (
	"fmt"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"

	"github.com/pkg/sftp"
)

// 部署路径常量（与 agent 默认值一致）
const (
	remoteBin     = "/usr/local/bin/spanel-agent"
	remoteBinNew  = "/tmp/spanel-agent.new"
	remoteBinOld  = "/usr/local/bin/spanel-agent.old"
	remoteDataDir = "/var/lib/spanel-agent"
	remoteUnit    = "/etc/systemd/system/spanel-agent.service"

	// diskWatermarkPct 与 agent 停写水位一致：剩余低于该百分比会丢弃全部采样
	diskWatermarkPct = 5.0
	minDataAvailKB   = 64 * 1024 // 数据分区至少 64 MB，避免 5% 在超小盘上仍不够落库
	minTmpAvailKB    = 32 * 1024 // 上传二进制约 10MB，/tmp 再留余量
	minMemAvailKB    = 96 * 1024 // 与 systemd MemoryMax 对齐
)

// systemd unit：含资源硬限制（宁可 agent 降级/退出，也不挤压业务）
const unitContent = `[Unit]
Description=SPanel Agent (server metrics collector)
After=network.target

[Service]
Type=simple
ExecStart=` + remoteBin + `
Restart=always
RestartSec=3
Nice=10
# 按需采集（进程/Docker 等）会 fork ps/ss/docker 等子进程，都在本 cgroup 内；
# 25% 上限足够按需命令秒回，同时仍是防失控硬顶（持续采集本身 <0.1% CPU）
CPUQuota=25%
CPUWeight=50
IOWeight=50
MemoryMax=96M
OOMScoreAdjust=500
Environment=GOMEMLIMIT=64MiB

[Install]
WantedBy=multi-user.target
`

// Installer 经 SSH 管理目标主机上的 agent
type Installer struct {
	mgr *sshd.Manager
}

// ProgressFn 安装过程进度回调：step 阶段（upload/replace）、percent 进度百分比
// （不确定时为 -1）、text 展示文案。允许为 nil。
type ProgressFn func(step string, percent int, text string)

func New(mgr *sshd.Manager) *Installer {
	return &Installer{mgr: mgr}
}

// ProbeInfo 安装前探测（架构、systemd、磁盘水位、内存、写权限）
type ProbeInfo struct {
	Arch         string // uname -m
	OS           string // uname -s
	HasSystemd   bool
	HasBinary    bool
	ServiceState string // active / inactive / failed / not-found
	DataMount    string
	DataTotalKB  uint64
	DataAvailKB  uint64
	TmpAvailKB   uint64
	BinAvailKB   uint64
	MemTotalKB   uint64
	MemAvailKB   uint64
	UID          int
	WritableBin  bool
	WritableTmp  bool
}

const probeScript = `echo "=OS=$(uname -s)"
echo "=ARCH=$(uname -m)"
echo "=UID=$(id -u)"
command -v systemctl >/dev/null 2>&1 && echo "=SYSTEMD=1" || echo "=SYSTEMD=0"
[ -f /usr/local/bin/spanel-agent ] && echo "=BIN=1" || echo "=BIN=0"
if [ -d /usr/local/bin ]; then
  [ -w /usr/local/bin ] && echo "=WR_BIN=1" || echo "=WR_BIN=0"
else
  [ -w /usr/local ] && echo "=WR_BIN=1" || echo "=WR_BIN=0"
fi
[ -w /tmp ] && echo "=WR_TMP=1" || echo "=WR_TMP=0"
echo "=SVC=$(systemctl is-active spanel-agent 2>/dev/null || true)"
DATA=/var/lib/spanel-agent
[ -e "$DATA" ] || DATA=/var/lib
[ -e "$DATA" ] || DATA=/
df -Pk "$DATA" 2>/dev/null | awk 'NR==2 {print "=DATA_TOTAL_KB="$2; print "=DATA_AVAIL_KB="$4; print "=DATA_MNT="$6}'
df -Pk /tmp 2>/dev/null | awk 'NR==2 {print "=TMP_AVAIL_KB="$4}'
df -Pk /usr/local 2>/dev/null | awk 'NR==2 {print "=BIN_AVAIL_KB="$4}'
if [ -r /proc/meminfo ]; then
  awk '/^MemAvailable:/ {a=$2} /^MemFree:/ {f=$2} /^MemTotal:/ {t=$2} END { if(a!="") print "=MEM_AVAIL_KB="a; else print "=MEM_AVAIL_KB="f; print "=MEM_TOTAL_KB="t }' /proc/meminfo
fi
`

// Probe 探测主机架构、agent 状态与安装环境（磁盘/内存/权限）
func (i *Installer) Probe(host string, opt sshd.ConnectOption) (ProbeInfo, error) {
	out, err := i.mgr.Run(host, opt, probeScript)
	if err != nil {
		return ProbeInfo{}, fmt.Errorf("探测失败: %w", err)
	}
	return parseProbe(string(out)), nil
}

func parseProbe(out string) ProbeInfo {
	var info ProbeInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "=OS="):
			info.OS = strings.TrimPrefix(line, "=OS=")
		case strings.HasPrefix(line, "=ARCH="):
			info.Arch = strings.TrimPrefix(line, "=ARCH=")
		case strings.HasPrefix(line, "=UID="):
			_, _ = fmt.Sscanf(strings.TrimPrefix(line, "=UID="), "%d", &info.UID)
		case line == "=SYSTEMD=1":
			info.HasSystemd = true
		case line == "=BIN=1":
			info.HasBinary = true
		case line == "=WR_BIN=1":
			info.WritableBin = true
		case line == "=WR_TMP=1":
			info.WritableTmp = true
		case strings.HasPrefix(line, "=SVC="):
			info.ServiceState = strings.TrimPrefix(line, "=SVC=")
		case strings.HasPrefix(line, "=DATA_TOTAL_KB="):
			_, _ = fmt.Sscanf(strings.TrimPrefix(line, "=DATA_TOTAL_KB="), "%d", &info.DataTotalKB)
		case strings.HasPrefix(line, "=DATA_AVAIL_KB="):
			_, _ = fmt.Sscanf(strings.TrimPrefix(line, "=DATA_AVAIL_KB="), "%d", &info.DataAvailKB)
		case strings.HasPrefix(line, "=DATA_MNT="):
			info.DataMount = strings.TrimPrefix(line, "=DATA_MNT=")
		case strings.HasPrefix(line, "=TMP_AVAIL_KB="):
			_, _ = fmt.Sscanf(strings.TrimPrefix(line, "=TMP_AVAIL_KB="), "%d", &info.TmpAvailKB)
		case strings.HasPrefix(line, "=BIN_AVAIL_KB="):
			_, _ = fmt.Sscanf(strings.TrimPrefix(line, "=BIN_AVAIL_KB="), "%d", &info.BinAvailKB)
		case strings.HasPrefix(line, "=MEM_AVAIL_KB="):
			_, _ = fmt.Sscanf(strings.TrimPrefix(line, "=MEM_AVAIL_KB="), "%d", &info.MemAvailKB)
		case strings.HasPrefix(line, "=MEM_TOTAL_KB="):
			_, _ = fmt.Sscanf(strings.TrimPrefix(line, "=MEM_TOTAL_KB="), "%d", &info.MemTotalKB)
		}
	}
	if info.ServiceState == "" {
		info.ServiceState = "not-found"
	}
	if info.UID == 0 {
		info.WritableBin = true
		info.WritableTmp = true
	}
	return info
}

func (p ProbeInfo) dataAvailPct() float64 {
	if p.DataTotalKB == 0 {
		return 100
	}
	return float64(p.DataAvailKB) / float64(p.DataTotalKB) * 100
}

// InstallBlockReason 环境不足以安装或采集时返回中文原因；空串表示可以装。
func (p ProbeInfo) InstallBlockReason() string {
	osname := strings.ToLower(p.OS)
	if osname != "" && osname != "linux" {
		return fmt.Sprintf("目标系统是 %s，spanel-agent 仅支持 Linux", p.OS)
	}
	if !p.HasSystemd {
		return "目标主机无 systemd，暂不支持安装"
	}
	if !p.WritableBin {
		return "当前用户不能写入 /usr/local/bin，请用 root 安装"
	}
	if !p.WritableTmp {
		return "当前用户不能写入 /tmp，无法上传 Agent 二进制"
	}
	if p.TmpAvailKB > 0 && p.TmpAvailKB < minTmpAvailKB {
		return fmt.Sprintf("/tmp 剩余 %s，上传 Agent 至少需要 %s，请清理后再安装",
			fmtKB(p.TmpAvailKB), fmtKB(minTmpAvailKB))
	}
	if p.BinAvailKB > 0 && p.BinAvailKB < minTmpAvailKB {
		return fmt.Sprintf("/usr/local 剩余 %s，安装 Agent 至少需要 %s，请清理后再安装",
			fmtKB(p.BinAvailKB), fmtKB(minTmpAvailKB))
	}
	if p.DataTotalKB > 0 {
		pct := p.dataAvailPct()
		mnt := p.DataMount
		if mnt == "" {
			mnt = "/var/lib"
		}
		if pct < diskWatermarkPct {
			return fmt.Sprintf("数据分区 %s 剩余 %.1f%%（%s / %s），低于采集停写水位 %.0f%%。装上后也无法落库，请先清理磁盘再安装",
				mnt, pct, fmtKB(p.DataAvailKB), fmtKB(p.DataTotalKB), diskWatermarkPct)
		}
		if p.DataAvailKB < minDataAvailKB {
			return fmt.Sprintf("数据分区 %s 剩余 %s，至少需要 %s 才能落库，请先清理磁盘再安装",
				mnt, fmtKB(p.DataAvailKB), fmtKB(minDataAvailKB))
		}
	}
	if p.MemAvailKB > 0 && p.MemAvailKB < minMemAvailKB {
		return fmt.Sprintf("内存可用 %s，Agent 需要至少 %s，请释放内存后再安装",
			fmtKB(p.MemAvailKB), fmtKB(minMemAvailKB))
	}
	return ""
}

func fmtKB(kb uint64) string {
	if kb >= 1024*1024 {
		return fmt.Sprintf("%.1f GB", float64(kb)/1024/1024)
	}
	if kb >= 1024 {
		return fmt.Sprintf("%.0f MB", float64(kb)/1024)
	}
	return fmt.Sprintf("%d KB", kb)
}

// Install 安装或更新（幂等）。流程：sftp 上传 → sha256 校验 → 备份旧版 → 原子替换
// → 确保 systemd unit → 启动。健康检查由调用方（app_agent）走 agentcli 隧道完成，
// 失败时调用 Rollback。prog 可为 nil；上传阶段回调 0~100 百分比，校验替换阶段回调 -1。
func (i *Installer) Install(host string, opt sshd.ConnectOption, bin []byte, wantSHA string, prog ProgressFn) error {
	info, err := i.Probe(host, opt)
	if err != nil {
		return err
	}
	if reason := info.InstallBlockReason(); reason != "" {
		return fmt.Errorf("%s", reason)
	}

	// 1) 上传 + 校验
	if err := i.upload(host, opt, bin, prog); err != nil {
		return err
	}
	sumOut, err := i.mgr.Run(host, opt, "sha256sum "+remoteBinNew)
	if err != nil {
		return fmt.Errorf("校验失败: %w", err)
	}
	got := strings.Fields(strings.TrimSpace(string(sumOut)))
	if len(got) == 0 || got[0] != wantSHA {
		return fmt.Errorf("sha256 不匹配（远端 %s）", firstOr(got, "空"))
	}

	// 2) 原子替换 + unit + 启动（组合命令一次往返）
	// 清理可能的异常残留：上次中断可能把 bin 留成目录形态（会挡住 mv 并导致 203/EXEC）
	if prog != nil {
		prog("replace", -1, "校验并替换二进制、启动服务")
	}
	script := fmt.Sprintf(`set -e
mkdir -p %[6]s && chmod 700 %[6]s
[ -d %[1]s ] && rm -rf %[1]s || true
[ -f %[1]s ] && mv %[1]s %[2]s || true
mv %[3]s %[1]s
chmod 755 %[1]s
if [ ! -f %[4]s ]; then
cat > %[4]s <<'UNIT'
%[5]sUNIT
fi
systemctl daemon-reload
systemctl enable spanel-agent >/dev/null 2>&1
systemctl restart spanel-agent
`, remoteBin, remoteBinOld, remoteBinNew, remoteUnit, unitContent, remoteDataDir)
	if out, err := i.mgr.Run(host, opt, script, sshd.RunOptions{Timeout: 60 * time.Second}); err != nil {
		return fmt.Errorf("安装命令失败: %v\n%s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Rollback 健康检查失败后恢复旧版（无旧版时停止服务并报错）
func (i *Installer) Rollback(host string, opt sshd.ConnectOption) error {
	script := fmt.Sprintf(`if [ -f %[1]s ]; then mv -f %[1]s %[2]s && systemctl restart spanel-agent; else systemctl stop spanel-agent 2>/dev/null || true; fi`,
		remoteBinOld, remoteBin)
	out, err := i.mgr.Run(host, opt, script, sshd.RunOptions{Timeout: 30 * time.Second})
	if err != nil {
		return fmt.Errorf("回滚失败: %v\n%s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Uninstall 卸载 agent；keepData=true 保留 /var/lib/spanel-agent（重装可续看历史）
func (i *Installer) Uninstall(host string, opt sshd.ConnectOption, keepData bool) error {
	script := fmt.Sprintf(`systemctl disable --now spanel-agent 2>/dev/null || true
rm -f %[1]s %[2]s %[3]s %[4]s
systemctl daemon-reload
`, remoteUnit, remoteBin, remoteBinOld, remoteBinNew)
	if !keepData {
		script += fmt.Sprintf("rm -rf %s\n", remoteDataDir)
	}
	out, err := i.mgr.Run(host, opt, script, sshd.RunOptions{Timeout: 30 * time.Second})
	if err != nil {
		return fmt.Errorf("卸载失败: %v\n%s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// upload sftp 上传二进制到远端临时路径（0644，安装命令再 chmod 755）。
// 分块写入并按 ~2% 步进回调上传百分比（prog 可为 nil）。
func (i *Installer) upload(host string, opt sshd.ConnectOption, bin []byte, prog ProgressFn) error {
	client, err := i.mgr.GetClient(host, opt)
	if err != nil {
		return fmt.Errorf("建立 SSH 连接失败: %w", err)
	}
	sc, err := sftp.NewClient(client)
	if err != nil {
		return fmt.Errorf("建立 sftp 通道失败: %w", err)
	}
	defer sc.Close()

	f, err := sc.Create(remoteBinNew)
	if err != nil {
		return fmt.Errorf("创建远端临时文件失败: %w", err)
	}
	const chunk = 512 * 1024
	total := len(bin)
	nextAt := 0 // 下次回调的百分比阈值（约每 2% 一次）
	for off := 0; off < total; off += chunk {
		end := off + chunk
		if end > total {
			end = total
		}
		if _, err := f.Write(bin[off:end]); err != nil {
			_ = f.Close()
			return fmt.Errorf("上传失败: %w", err)
		}
		pct := end * 100 / total
		if prog != nil && pct >= nextAt {
			prog("upload", pct, fmt.Sprintf("上传 Agent 二进制 %d%%（共 %.1f MB）", pct, float64(total)/1024/1024))
			nextAt = pct + 2
		}
	}
	if err := f.Chmod(0o644); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// WaitHealthy 轮询远端 systemd 直到 agent 服务 active（安装后拉起需要一点时间）。
// 只依赖 systemctl（Probe 已确保存在），不依赖 curl 等外部工具——无 curl 的
// 最小化系统上 curl 探测会 exit 127 导致安装被误判失败；真正的 HTTP/版本
// 校验由调用方经隧道 GetJSON /health 完成，失败走回滚。
// prog 可为 nil；按已等待时长回调 0~100 百分比。
func (i *Installer) WaitHealthy(host string, opt sshd.ConnectOption, timeout time.Duration, prog ProgressFn) error {
	start := time.Now()
	deadline := start.Add(timeout)
	nextAt := 0
	// active 后再稳定等 1s，给 HTTP 监听一点就绪余量
	for time.Now().Before(deadline) {
		out, err := i.mgr.Run(host, opt, "systemctl is-active spanel-agent 2>/dev/null",
			sshd.RunOptions{Timeout: 5 * time.Second})
		if err == nil && strings.TrimSpace(string(out)) == "active" {
			time.Sleep(1 * time.Second)
			return nil
		}
		if prog != nil {
			elapsed := int(time.Since(start).Seconds() * 100 / timeout.Seconds())
			if elapsed >= nextAt {
				prog("start", elapsed, "等待 agent 服务就绪…")
				nextAt = elapsed + 5
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("agent 服务未在 %s 内进入 active", timeout)
}

func firstOr(ss []string, def string) string {
	if len(ss) > 0 {
		return ss[0]
	}
	return def
}
