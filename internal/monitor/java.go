package monitor

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// JavaProc 单个 Java 进程的列表信息（Java 标签页主列表）
type JavaProc struct {
	PID       uint32   `json:"pid"`
	User      string   `json:"user"`
	CPU       float64  `json:"cpu"`
	Mem       float64  `json:"mem"` // 百分比
	RSS       uint64   `json:"rss"` // bytes
	Elapsed   uint64   `json:"elapsed"`
	Args      string   `json:"args"` // 完整命令行
	Jar       string   `json:"jar"`  // -jar 的包路径（非 jar 启动时为空）
	Xms       uint64   `json:"xms"`  // -Xms 初始堆大小 bytes（未显式设置为 0）
	Xmx       uint64   `json:"xmx"`  // -Xmx 最大堆大小 bytes（未显式设置为 0）
	Ports     []string `json:"ports"`
	Deploy    string   `json:"deploy"`    // systemd / docker / process
	Service   string   `json:"service"`   // systemd 服务名（含 .service，systemd 部署时）
	Container string   `json:"container"` // docker 容器名（docker 部署时）
	Image     string   `json:"image"`     // docker 镜像（docker 部署时）
}

// JavaProcDetail 单个 Java 进程的补充详情（悬浮卡片按需查询）
type JavaProcDetail struct {
	PID        uint32 `json:"pid"`
	WorkDir    string `json:"workDir"`    // /proc/<pid>/cwd
	ExePath    string `json:"exePath"`    // /proc/<pid>/exe（java 可执行文件真实路径）
	ReadBytes  uint64 `json:"readBytes"`  // /proc/<pid>/io 累计读（无权限时为 0）
	WriteBytes uint64 `json:"writeBytes"` // 累计写
}

// CollectJavaProcs 采集所有运行中的 Java 进程（含部署方式 / 端口 / jar 路径）
// 部署判定走 /proc/<pid>/cgroup：
//   - 路径含 xxx.service → systemd 部署，记录服务名
//   - 路径含 docker[-/]<容器ID> → docker 部署，用 docker ps 反查容器名/镜像
//   - 其余 → process（手动/脚本直跑）
func (c *Collector) CollectJavaProcs(host string, opt sshd.ConnectOption) ([]JavaProc, error) {
	out, err := c.mgr.Run(host, opt,
		`ps -eo pid,ppid,user,pcpu,pmem,rss,etime,comm,args --sort=-pcpu | awk '$8=="java"'`)
	if err != nil {
		return nil, err
	}
	list := parseJavaPs(string(out))
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
		p.Jar = jarFromArgs(p.Args)
		p.Xms, p.Xmx = heapFromArgs(p.Args)
		p.Ports = portsForPid(string(ssOut), p.PID)
		classifyJavaDeploy(cgByPid["CG="+strconv.Itoa(int(p.PID))], string(dockerOut), p)
	}
	return list, nil
}

// parseJavaPs 解析 ps 输出：pid ppid user pcpu pmem rss etime comm args...
func parseJavaPs(s string) []JavaProc {
	out := []JavaProc{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}
		pid, _ := strconv.ParseUint(fields[0], 10, 32)
		cpu, _ := strconv.ParseFloat(fields[3], 64)
		mem, _ := strconv.ParseFloat(fields[4], 64)
		rssKB, _ := strconv.ParseUint(fields[5], 10, 64)
		out = append(out, JavaProc{
			PID:     uint32(pid),
			User:    fields[2],
			CPU:     cpu,
			Mem:     mem,
			RSS:     rssKB * 1024,
			Elapsed: parseElapsedToSeconds(fields[6]),
			Args:    strings.Join(fields[8:], " "),
		})
	}
	return out
}

// jarFromArgs 从命令行提取 -jar 的包路径；没有 -jar 时找第一个 *.jar 参数
func jarFromArgs(args string) string {
	fields := strings.Fields(args)
	for i, f := range fields {
		if f == "-jar" && i+1 < len(fields) {
			return fields[i+1]
		}
	}
	for _, f := range fields {
		if strings.HasSuffix(f, ".jar") {
			return f
		}
	}
	return ""
}

// heapFromArgs 从命令行解析初始/最大堆大小（-Xms / -Xmx / -XX:InitialHeapSize= / -XX:MaxHeapSize=）
// 未显式设置时返回 0（JVM 会取默认值，默认值只能进进程内部才知道）
func heapFromArgs(args string) (xms, xmx uint64) {
	for _, f := range strings.Fields(args) {
		switch {
		case strings.HasPrefix(f, "-Xms"):
			xms = parseJvmMemBytes(f[4:])
		case strings.HasPrefix(f, "-Xmx"):
			xmx = parseJvmMemBytes(f[4:])
		case strings.HasPrefix(f, "-XX:InitialHeapSize="):
			xms = parseJvmMemBytes(f[len("-XX:InitialHeapSize="):])
		case strings.HasPrefix(f, "-XX:MaxHeapSize="):
			xmx = parseJvmMemBytes(f[len("-XX:MaxHeapSize="):])
		}
	}
	return xms, xmx
}

// parseJvmMemBytes JVM 内存参数值 → bytes："4g" / "512m" / "1024k" / "268435456"（K/M/G 按二进制 1024 进位）
func parseJvmMemBytes(v string) uint64 {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	mult := uint64(1)
	switch v[len(v)-1] {
	case 'k', 'K':
		mult, v = 1024, v[:len(v)-1]
	case 'm', 'M':
		mult, v = 1024*1024, v[:len(v)-1]
	case 'g', 'G':
		mult, v = 1024*1024*1024, v[:len(v)-1]
	}
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return 0
	}
	return n * mult
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

// classifyJavaDeploy 按 cgroup 内容判定部署方式并回填服务名/容器信息
func classifyJavaDeploy(cgroup, dockerOut string, p *JavaProc) {
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
	// docker：cgroup 含容器 ID（容器内 Java 进程在宿主机 ps 可见）
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

// CollectJavaProcDetail 悬浮卡片触发的按需详情：工作目录 / java 可执行路径 / 磁盘 IO
// 注意：readlink/cat 在权限不足时以非零退出码结束，SSH 层会把整条命令判为失败，
// 所以每段跟 || true 兜底，保证命令整体退出码为 0、已拿到的字段正常返回
func (c *Collector) CollectJavaProcDetail(host string, pid uint32, opt sshd.ConnectOption) (JavaProcDetail, error) {
	if pid == 0 {
		return JavaProcDetail{}, fmt.Errorf("非法 PID")
	}
	out, err := c.mgr.Run(host, opt, fmt.Sprintf(
		`echo =CWD=; readlink /proc/%d/cwd 2>/dev/null || true; echo =EXE=; readlink /proc/%d/exe 2>/dev/null || true; echo =IO=; cat /proc/%d/io 2>/dev/null; true`,
		pid, pid, pid,
	))
	if err != nil {
		return JavaProcDetail{}, err
	}
	d := JavaProcDetail{PID: pid}
	sec := splitSections(string(out))
	d.WorkDir = sec["CWD"]
	d.ExePath = sec["EXE"]
	for _, line := range strings.Split(sec["IO"], "\n") {
		kv := strings.SplitN(strings.TrimSpace(line), ":", 2)
		if len(kv) != 2 {
			continue
		}
		v, _ := strconv.ParseUint(strings.TrimSpace(kv[1]), 10, 64)
		switch kv[0] {
		case "read_bytes":
			d.ReadBytes = v
		case "write_bytes":
			d.WriteBytes = v
		}
	}
	return d, nil
}
