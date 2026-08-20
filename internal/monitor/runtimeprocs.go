package monitor

import (
	"debug/buildinfo"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/sshd"
)

// RuntimeProc 运行时进程（java/go/node/bun/python）的列表信息（进程页各运行时视图主列表）
type RuntimeProc struct {
	PID       uint32   `json:"pid"`
	User      string   `json:"user"`
	CPU       float64  `json:"cpu"`
	Mem       float64  `json:"mem"` // 百分比
	RSS       uint64   `json:"rss"` // bytes
	Elapsed   uint64   `json:"elapsed"`
	Args      string   `json:"args"`  // 完整命令行
	Entry     string   `json:"entry"` // 入口：java=jar 路径；node/bun/python=脚本；go=可执行文件路径
	Xms       uint64   `json:"xms"`   // 仅 java：-Xms 初始堆 bytes（未显式设置为 0）
	Xmx       uint64   `json:"xmx"`   // 仅 java：-Xmx 最大堆 bytes
	Ports     []string `json:"ports"`
	Deploy    string   `json:"deploy"`    // systemd / docker / process
	Service   string   `json:"service"`   // systemd 服务名（含 .service，systemd 部署时）
	Container string   `json:"container"` // docker 容器名（docker 部署时）
	Image     string   `json:"image"`     // docker 镜像（docker 部署时）
}

// runtimeCommFilter 按进程可执行文件名（comm，ps 输出的第 7 列）过滤的 awk 片段。
// 注意：$7 才是 comm 列；$8 是 args 的第一个词——java 恰好两者相同，
// 但 python 经 venv/绝对路径启动时 args[0] 是路径不是 "python"，用 $8 会全部漏掉。
// python 需兼容 python / python3 / python3.11 等派生名
var runtimeCommFilter = map[string]string{
	"java":   `$7=="java"`,
	"node":   `$7=="node" || $7=="nodejs"`,
	"bun":    `$7=="bun" || $7=="bun-debug"`,
	"python": `$7=="python" || $7 ~ /^python[0-9.]*$/`,
}

// RuntimeCounts 各运行时正在运行的进程数（进程页标签徽标）
type RuntimeCounts struct {
	Java   int `json:"java"`
	Go     int `json:"go"`
	Node   int `json:"node"`
	Bun    int `json:"bun"`
	Python int `json:"python"`
}

// CollectRuntimeCounts 统计各运行时正在运行的进程数：
// java/node/bun/python 一条 ps+awk（comm 与 runtimeCommFilter 同规则）；
// go 复用 scanGoProcs 识别 Go 二进制（读全部 /proc/*/exe，约几百毫秒）
func (c *Collector) CollectRuntimeCounts(host string, opt sshd.ConnectOption) (RuntimeCounts, error) {
	var rc RuntimeCounts
	out, err := c.mgr.Run(host, opt,
		`ps -eo comm= | awk '$1=="java"{j++} $1=="node"||$1=="nodejs"{n++} $1=="bun"||$1=="bun-debug"{b++} $1 ~ /^python[0-9.]*$/{p++} END{print j+0, n+0, b+0, p+0}'`)
	if err != nil {
		return rc, err
	}
	fields := strings.Fields(string(out))
	if len(fields) == 4 {
		rc.Java, _ = strconv.Atoi(fields[0])
		rc.Node, _ = strconv.Atoi(fields[1])
		rc.Bun, _ = strconv.Atoi(fields[2])
		rc.Python, _ = strconv.Atoi(fields[3])
	}
	// go 计数失败不影响其它运行时的结果
	rc.Go = len(c.scanGoProcs())
	return rc, nil
}

// CollectRuntimeProcs 采集指定运行时的所有进程（含部署方式 / 端口 / 入口）
// java/node/bun/python 按 comm 过滤 ps 输出；
// go 是编译型语言没有固定进程名，通过扫描 /proc/<pid>/exe 的 Go buildinf 标记识别。
// 部署判定走 /proc/<pid>/cgroup（详见 classifyDeploy）
func (c *Collector) CollectRuntimeProcs(host, runtime string, opt sshd.ConnectOption) ([]RuntimeProc, error) {
	if _, ok := runtimeCommFilter[runtime]; !ok && runtime != "go" {
		return nil, fmt.Errorf("不支持的运行时: %s", runtime)
	}

	var psOut []byte
	goExe := map[uint32]string{} // go 进程 PID → 可执行文件路径
	if runtime == "go" {
		goExe = c.scanGoProcs()
		if len(goExe) == 0 {
			return []RuntimeProc{}, nil
		}
		pids := make([]string, 0, len(goExe))
		for pid := range goExe {
			pids = append(pids, strconv.FormatUint(uint64(pid), 10))
		}
		cmd := fmt.Sprintf(
			"ps -o pid=,user=,pcpu=,pmem=,rss=,etime=,comm=,args= --sort=-pcpu -p %s",
			strings.Join(pids, ","),
		)
		out, err := c.mgr.Run(host, opt, cmd)
		if err != nil {
			return nil, err
		}
		psOut = out
	} else {
		out, err := c.mgr.Run(host, opt,
			`ps -eo pid,user,pcpu,pmem,rss,etime,comm,args --sort=-pcpu | awk '`+runtimeCommFilter[runtime]+`'`)
		if err != nil {
			return nil, err
		}
		psOut = out
	}

	list := parseRuntimePs(string(psOut))
	if len(list) == 0 {
		return list, nil
	}

	// 所有 PID 的 cgroup 拼成一条命令（echo =CG=<pid>= 分段）
	var sb strings.Builder
	for _, p := range list {
		fmt.Fprintf(&sb, "echo =CG=%d=; cat /proc/%d/cgroup 2>/dev/null; ", p.PID, p.PID)
	}
	// cgroup 与 ss 并行执行；docker ps 仅在存在容器内进程时才查（秒级），
	// 且走 15s 缓存——部署方式标注对容器列表新鲜度要求不高（Docker 管理页保持实时）
	var (
		cgOut []byte
		ssOut []byte
		wg    sync.WaitGroup
	)
	wg.Add(2)
	go func() { defer wg.Done(); cgOut, _ = c.mgr.Run(host, opt, sb.String()) }()
	go func() { defer wg.Done(); ssOut, _ = c.mgr.Run(host, opt, `ss -tlnp 2>/dev/null`) }()
	wg.Wait()
	cgByPid := splitSections(string(cgOut))

	var dockerOut []byte
	for _, v := range cgByPid {
		if reDockerCgroup.MatchString(v) {
			dockerOut = c.dockerPsList(host, opt)
			break
		}
	}

	for i := range list {
		p := &list[i]
		p.Ports = portsForPid(string(ssOut), p.PID)
		classifyDeploy(cgByPid["CG="+strconv.Itoa(int(p.PID))], string(dockerOut), p)
		switch runtime {
		case "java":
			p.Entry = jarFromArgs(p.Args)
			p.Xms, p.Xmx = heapFromArgs(p.Args)
		case "go":
			p.Entry = goExe[p.PID]
		default:
			p.Entry = scriptFromArgs(runtime, p.Args)
		}
	}
	return list, nil
}

// parseRuntimePs 解析 ps 输出：pid user pcpu pmem rss etime comm args...
func parseRuntimePs(s string) []RuntimeProc {
	out := []RuntimeProc{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}
		pid, _ := strconv.ParseUint(fields[0], 10, 32)
		cpu, _ := strconv.ParseFloat(fields[2], 64)
		mem, _ := strconv.ParseFloat(fields[3], 64)
		rssKB, _ := strconv.ParseUint(fields[4], 10, 64)
		out = append(out, RuntimeProc{
			PID:     uint32(pid),
			User:    fields[1],
			CPU:     cpu,
			Mem:     mem,
			RSS:     rssKB * 1024,
			Elapsed: parseElapsedToSeconds(fields[5]),
			Args:    strings.Join(fields[7:], " "),
		})
	}
	return out
}

// goScanCacheTTL Go 进程扫描缓存有效期：与 runtime-procs 的 5s 轮询、
// runtime-counts 的 30s 轮询搭配，缓存过期才重扫一次 /proc
const goScanCacheTTL = 15 * time.Second

// dockerPsCacheTTL 容器 ID→名称/镜像映射缓存有效期（秒级命令，容器列表低频变化）
const dockerPsCacheTTL = 15 * time.Second

// scanGoProcs 识别本机所有 Go 二进制进程（agent 场景：/proc 即目标主机）。
// 纯 Go 实现：debug/buildinfo 按 ELF section 精确定位 Go 标记（毫秒级/进程），
// 不再经 shell grep 全文扫描（大二进制的标记可能在几十 MB 偏移处，全文扫描秒级且费 CPU）。
// 结果缓存 goScanCacheTTL：runtime-counts 与 runtime-procs 共享，轮询近乎零成本。
func (c *Collector) scanGoProcs() map[uint32]string {
	c.goScanMu.Lock()
	defer c.goScanMu.Unlock()
	if c.goScanData != nil && time.Since(c.goScanAt) < goScanCacheTTL {
		return c.goScanData
	}
	m := map[uint32]string{}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return m
	}
	for _, e := range entries {
		pid, err := strconv.ParseUint(e.Name(), 10, 32)
		if err != nil {
			continue // 非数字目录（/proc/self 等）
		}
		exe, err := os.Readlink("/proc/" + e.Name() + "/exe")
		if err != nil || exe == "" || strings.HasSuffix(exe, " (deleted)") {
			continue
		}
		// 非 Go 二进制（ELF 无 go.buildinfo）返回错误，据此排除
		if _, err := buildinfo.ReadFile(exe); err == nil {
			m[uint32(pid)] = exe
		}
	}
	c.goScanData, c.goScanAt = m, time.Now()
	return m
}

// bun 子命令不是入口脚本，提取入口时跳过（bun run server.ts → server.ts）
var bunSubcommands = map[string]bool{
	"run": true, "x": true, "dev": true, "create": true,
	"install": true, "i": true, "add": true, "remove": true,
	"update": true, "upgrade": true, "init": true, "pm": true,
	"link": true, "unlink": true, "publish": true, "outdated": true,
	"patch": true, "why": true,
}

// scriptFromArgs 从解释器命令行提取入口脚本：取解释器（fields[0]）之后第一个非选项参数。
// 局限：带值选项（node --require x.js server.js、python -m http.server）会取到选项的值
// 或模块名（http.server 本身也有信息量），服务器上主流用法（node server.js / bun run x.ts）
// 均可正确命中
func scriptFromArgs(runtime, args string) string {
	fields := strings.Fields(args)
	i := 1
	skipOptions := func() bool {
		for i < len(fields) && strings.HasPrefix(fields[i], "-") {
			// -c 执行的是内联代码（ps 输出中代码与参数无法区分），没有入口脚本可言
			if fields[i] == "-c" {
				return false
			}
			i++
		}
		return true
	}
	if !skipOptions() {
		return ""
	}
	if runtime == "bun" {
		for i < len(fields) && bunSubcommands[fields[i]] {
			i++
			skipOptions()
		}
	}
	if i < len(fields) {
		return fields[i]
	}
	return ""
}

// dockerPsList 容器 ID→名称/镜像映射（classifyDeploy 用），15s 缓存；
// Docker 管理页的实时列表走 CollectDocker，不经过这里
func (c *Collector) dockerPsList(host string, opt sshd.ConnectOption) []byte {
	c.dockerPsMu.Lock()
	defer c.dockerPsMu.Unlock()
	if time.Since(c.dockerPsAt) < dockerPsCacheTTL {
		return c.dockerPsOut
	}
	out, _ := c.mgr.Run(host, opt, `docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}' 2>/dev/null`)
	c.dockerPsOut, c.dockerPsAt = out, time.Now()
	return out
}

// portsForPid 从 ss -tlnp 输出中提取指定 PID 的监听地址（"0.0.0.0:8080" 形式）
func portsForPid(ssOut string, pid uint32) []string {
	ports := []string{}
	tag := fmt.Sprintf("pid=%d,", pid)
	for _, line := range strings.Split(ssOut, "\n") {
		if !strings.Contains(line, tag) {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		local := fields[3] // 如 0.0.0.0:8080 / [::]:8080 / *:3306
		if i := strings.LastIndex(local, ":"); i >= 0 {
			ports = append(ports, local)
		}
	}
	return ports
}

// reDockerCgroup 匹配 cgroup 里的 docker 容器 ID（docker-<id>.scope 或 /docker/<id>）
var reDockerCgroup = regexp.MustCompile(`docker[-/]([0-9a-f]{12,64})`)

// classifyDeploy 按 cgroup 内容判定部署方式并回填服务名/容器信息：
//   - 路径含 xxx.service → systemd 部署，记录服务名
//   - 路径含 docker[-/]<容器ID> → docker 部署，用 docker ps 反查容器名/镜像
//   - 其余 → process（手动/脚本直跑）
func classifyDeploy(cgroup, dockerOut string, p *RuntimeProc) {
	p.Deploy = "process"
	if cgroup == "" {
		return
	}
	// systemd：路径段以 .service 结尾（如 /system.slice/app.service）
	for _, seg := range strings.Split(cgroup, "/") {
		if strings.HasSuffix(seg, ".service") {
			p.Deploy = "systemd"
			p.Service = seg
			return
		}
	}
	// docker：cgroup 含容器 ID（容器内进程在宿主机 ps 可见）
	if m := reDockerCgroup.FindStringSubmatch(cgroup); m != nil {
		p.Deploy = "docker"
		fullID := m[1]
		for _, line := range strings.Split(dockerOut, "\n") {
			parts := strings.SplitN(strings.TrimSpace(line), "|", 3)
			if len(parts) == 3 && strings.HasPrefix(fullID, parts[0]) {
				p.Container = parts[1]
				p.Image = parts[2]
				break
			}
		}
	}
}
