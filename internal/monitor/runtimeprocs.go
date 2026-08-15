package monitor

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

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

// runtimeCommFilter 按进程可执行文件名（comm）过滤的 awk 片段
// python 需兼容 python / python3 / python3.11 等派生名
var runtimeCommFilter = map[string]string{
	"java":   `$8=="java"`,
	"node":   `$8=="node" || $8=="nodejs"`,
	"bun":    `$8=="bun" || $8=="bun-debug"`,
	"python": `$8=="python" || $8 ~ /^python[0-9.]*$/`,
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
		var err error
		goExe, err = c.scanGoProcs(host, opt)
		if err != nil {
			return nil, err
		}
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
	cgOut, _ := c.mgr.Run(host, opt, sb.String())
	cgByPid := splitSections(string(cgOut))

	dockerOut, _ := c.mgr.Run(host, opt, `docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}' 2>/dev/null`)
	ssOut, _ := c.mgr.Run(host, opt, `ss -tlnp 2>/dev/null`)

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

// scanGoProcs 扫描全部进程的可执行文件，识别 Go 编译的二进制（go1.18+）
// Go 二进制内含 "Go buildinf" 标记，grep -q 命中即停止（非 Go 二进制会被完整读取，
// 走页缓存，典型主机一次扫描约几百毫秒）；结尾 true 兜底保证整条命令退出码为 0
func (c *Collector) scanGoProcs(host string, opt sshd.ConnectOption) (map[uint32]string, error) {
	out, err := c.mgr.Run(host, opt,
		`for d in /proc/[0-9]*; do exe=$(readlink "$d/exe" 2>/dev/null) || continue; grep -aq "Go buildinf" "$d/exe" 2>/dev/null && echo "${d#/proc/} $exe"; done; true`)
	if err != nil {
		return nil, err
	}
	m := map[uint32]string{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.ParseUint(fields[0], 10, 32)
		if err != nil {
			continue
		}
		m[uint32(pid)] = strings.Join(fields[1:], " ")
	}
	return m, nil
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
	skipOptions := func() {
		for i < len(fields) && strings.HasPrefix(fields[i], "-") {
			i++
		}
	}
	skipOptions()
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
