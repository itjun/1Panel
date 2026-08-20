package monitor

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/sshd"
)

// Runner 命令执行通道：面板侧由 sshd.Manager 实现（经 SSH 执行），
// agent 侧由本地 exec 实现（见 internal/agent），采集脚本与解析逻辑两边共用
type Runner interface {
	Run(host string, opt sshd.ConnectOption, cmd string, runOpts ...sshd.RunOptions) ([]byte, error)
}

// Collector 监控数据采集器（依赖 Runner 执行通道）。
// 使用约束：goScan/dockerPs/dockerStats/egress 四组缓存与 scanGoProcs 的本机直读
// 均为「agent 单机场景」设计（每个 agent 进程一个实例、只管本机）。
// 面板进程构造的多主机 Collector（app.go）只允许调用 DetectOSRelease——
// 其余方法在面板侧已切换为 agent HTTP（见 app_monitor.go），勿在面板侧新增直调。
// lastStat 仍按 host 分键，维护每台主机的上次 CPU 时间片用于差分。
type Collector struct {
	mu       sync.Mutex
	mgr      Runner
	lastStat map[string][10]uint64 // host -> 上次 cpu 各列 jiffies

	// Go 进程扫描缓存（识别需遍历 /proc 读 buildinfo，轮询共享；见 runtimeprocs.go）
	goScanMu   sync.Mutex
	goScanAt   time.Time
	goScanData map[uint32]string

	// docker ps 容器映射缓存（classifyDeploy 用；Docker 管理页保持实时不走缓存）
	dockerPsMu  sync.Mutex
	dockerPsAt  time.Time
	dockerPsOut []byte

	// 容器 stats 采样缓存（docker stats --no-stream 秒级；Next 含失败退避）
	dockerStatsMu   sync.Mutex
	dockerStatsNext time.Time
	dockerStatsOut  string

	// 出口 IP 探测缓存（外网请求；Next 含失败退避）
	egressMu   sync.Mutex
	egressNext time.Time
	egressOut  string
}

func NewCollector(mgr Runner) *Collector {
	return &Collector{mgr: mgr, lastStat: map[string][10]uint64{}}
}

// CollectOverview 采集顶层系统指标（CPU/MEM/负载/磁盘汇总）
// 命令策略（Debian/Ubuntu）：
//   - /proc/stat：CPU 时间片
//   - /proc/meminfo + free -b：内存
//   - /proc/loadavg：负载
//   - uname + /etc/os-release：内核与发行版
func (c *Collector) CollectOverview(host string, opt sshd.ConnectOption) (Overview, error) {
	// 用一个组合命令一次性拿数据，减少 SSH 往返次数
	// PRETTY_NAME 是 os-release 标准字段（systemd 规范），Debian/Ubuntu/CentOS 都有
	// NET：/proc/net/dev 累计收发；HOST：主机名 + 架构；IP：默认路由出口 IP
	script := `echo "=STAT="; head -n1 /proc/stat; echo "=MEMINFO="; grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo; echo "=LOAD="; cat /proc/loadavg; echo "=UPTIME="; awk '{print $1}' /proc/uptime; echo "=CPUINFO="; grep -c processor /proc/cpuinfo; grep -m1 'model name' /proc/cpuinfo; echo "=OS="; uname -r; grep -E '^(PRETTY_NAME|NAME)=' /etc/os-release 2>/dev/null | head -n2; echo "=HOST="; hostname 2>/dev/null; uname -m; echo "=IP="; (ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || hostname -I 2>/dev/null | awk '{print $1}'); echo "=DEFDEV="; ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}'; echo "=NET="; cat /proc/net/dev 2>/dev/null; echo "=DISKIO="; cat /proc/diskstats 2>/dev/null`
	out, err := c.mgr.Run(host, opt, script)
	if err != nil {
		return Overview{}, err
	}
	o, err := parseOverview(string(out))
	if err != nil {
		return o, err
	}
	// CPU 差分计算：基于上次采样的 jiffies 算瞬时使用率
	// 注意 o.CPUPercent 此处仅作为「自启动以来的累计平均」fallback
	c.mu.Lock()
	o.CPUPercent = c.computeCPUDiffLocked(host, string(out), o.CPUPercent)
	c.mu.Unlock()
	return o, nil
}

// computeCPUDiffLocked 调用者必须持有 c.mu
// raw 是脚本原始输出（用于重新提取 stat 字段），approxPct 是无上次采样时的 fallback
func (c *Collector) computeCPUDiffLocked(host, raw string, approxPct float64) float64 {
	// 重新从原始输出中提取 /proc/stat 第一行
	statLine := ""
	for _, line := range strings.Split(raw, "\n") {
		if strings.HasPrefix(line, "cpu ") {
			statLine = line
			break
		}
	}
	if statLine == "" {
		return approxPct
	}
	fields := strings.Fields(statLine)
	if len(fields) < 5 {
		return approxPct
	}
	// /proc/stat cpu 行：user nice system idle iowait irq softirq steal guest guest_nice
	var cur [10]uint64
	for i := 1; i < len(fields) && i <= 10; i++ {
		v, _ := strconv.ParseUint(fields[i], 10, 64)
		cur[i-1] = v
	}
	prev, hasPrev := c.lastStat[host]
	c.lastStat[host] = cur
	if !hasPrev {
		return approxPct // 首次采样无差分，用近似值
	}
	// 计算差分
	var curSum, curIdle, prevSum, prevIdle uint64
	curIdle = cur[3] + cur[4] // idle + iowait
	prevIdle = prev[3] + prev[4]
	for i := 0; i < 10; i++ {
		curSum += cur[i]
		prevSum += prev[i]
	}
	totalDelta := int64(curSum) - int64(prevSum)
	idleDelta := int64(curIdle) - int64(prevIdle)
	if totalDelta <= 0 {
		return approxPct
	}
	usage := float64(totalDelta-idleDelta) / float64(totalDelta) * 100
	if usage < 0 {
		usage = 0
	}
	if usage > 100 {
		usage = 100
	}
	return usage
}

func parseOverview(s string) (Overview, error) {
	o := Overview{}
	sections := splitSections(s)
	if stat := sections["STAT"]; stat != "" {
		o.CPUPercent = parseCPUUsageLine(stat)
	}
	if mi := sections["MEMINFO"]; mi != "" {
		memTotal, memAvail := uint64(0), uint64(0)
		swapTotal, swapFree := uint64(0), uint64(0)
		for _, line := range strings.Split(mi, "\n") {
			k, v, ok := splitKVColon(line)
			if !ok {
				continue
			}
			n := parseMemValue(v)
			switch k {
			case "MemTotal":
				memTotal = n
			case "MemAvailable":
				memAvail = n
			case "SwapTotal":
				swapTotal = n
			case "SwapFree":
				swapFree = n
			}
		}
		o.MemTotal = memTotal
		o.MemUsed = memTotal - memAvail
		if memTotal > 0 {
			o.MemPercent = pct(o.MemUsed, memTotal)
		}
		o.SwapTotal = swapTotal
		o.SwapUsed = swapTotal - swapFree
		if swapTotal > 0 {
			o.SwapPercent = pct(o.SwapUsed, swapTotal)
		}
	}
	if load := sections["LOAD"]; load != "" {
		fields := strings.Fields(load)
		if len(fields) >= 3 {
			o.Load1, _ = strconv.ParseFloat(fields[0], 64)
			o.Load5, _ = strconv.ParseFloat(fields[1], 64)
			o.Load15, _ = strconv.ParseFloat(fields[2], 64)
		}
	}
	if up := sections["UPTIME"]; up != "" {
		// /proc/uptime 第一字段是秒数（含小数）
		fields := strings.Fields(up)
		if len(fields) > 0 {
			f, _ := strconv.ParseFloat(fields[0], 64)
			o.Uptime = uint64(f)
		}
	}
	if ci := sections["CPUINFO"]; ci != "" {
		lines := strings.Split(ci, "\n")
		if len(lines) >= 1 {
			o.CPUCount, _ = strconv.Atoi(strings.TrimSpace(lines[0]))
		}
		for _, line := range lines {
			if strings.Contains(line, "model name") {
				_, v, ok := splitKVColon(line)
				if ok {
					o.CPUModel = strings.TrimSpace(strings.Trim(v, "\""))
				}
				break
			}
		}
	}
	if osr := sections["OS"]; osr != "" {
		lines := strings.Split(osr, "\n")
		if len(lines) >= 1 {
			o.Kernel = strings.TrimSpace(lines[0])
		}
		o.OSRelease = parseOSReleaseText(osr)
	}
	if hostSec := sections["HOST"]; hostSec != "" {
		lines := strings.Split(hostSec, "\n")
		if len(lines) >= 1 {
			o.Hostname = strings.TrimSpace(lines[0])
		}
		if len(lines) >= 2 {
			o.Arch = strings.TrimSpace(lines[1])
		}
	}
	if ipSec := sections["IP"]; ipSec != "" {
		// 取第一行非空
		for _, line := range strings.Split(ipSec, "\n") {
			s := strings.TrimSpace(line)
			if s != "" {
				o.IPAddress = s
				break
			}
		}
	}
	// 默认路由出口网卡：概览网速只统计它，避免 docker0/veth 与 eth0 重复计数
	defDev := ""
	if dd := sections["DEFDEV"]; dd != "" {
		for _, line := range strings.Split(dd, "\n") {
			s := strings.TrimSpace(line)
			if s != "" {
				defDev = s
				break
			}
		}
	}
	if netSec := sections["NET"]; netSec != "" {
		o.NetRxBytes, o.NetTxBytes = ParseNetDev(netSec, defDev)
	}
	if dio := sections["DISKIO"]; dio != "" {
		o.DiskReadBytes, o.DiskWriteBytes, o.DiskIOCount = ParseDiskStats(dio)
	}
	return o, nil
}

// ParseNetDev 解析 /proc/net/dev 的收发字节
// defDev 非空时只统计该网卡（默认路由出口，即主机实际对外带宽）；
// 为空或找不到该网卡时回退为合计除 lo 外所有网卡
// 格式：Interface: rx_bytes rx_packets ... tx_bytes tx_packets ...
// 面板与 agent 共用，保证两边网速口径一致
func ParseNetDev(s, defDev string) (rx, tx uint64) {
	if defDev != "" {
		if r, t, ok := netDevIface(s, defDev); ok {
			return r, t
		}
	}
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, ":") {
			continue
		}
		// 跳过表头
		if strings.HasPrefix(line, "Inter-") || strings.HasPrefix(line, "face") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		if name == "lo" || name == "" {
			continue
		}
		r, t, _ := netDevIface(line, name)
		rx += r
		tx += t
	}
	return rx, tx
}

// netDevIface 从单行或整段 /proc/net/dev 内容中取指定网卡的收发字节
func netDevIface(s, name string) (rx, tx uint64, ok bool) {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, name+":") {
			continue
		}
		fields := strings.Fields(line[len(name)+1:])
		// rx_bytes=0, tx_bytes=8
		if len(fields) < 9 {
			return 0, 0, false
		}
		r, _ := strconv.ParseUint(fields[0], 10, 64)
		t, _ := strconv.ParseUint(fields[8], 10, 64)
		return r, t, true
	}
	return 0, 0, false
}

// diskDevRe 匹配物理块设备名（排除分区 sda1/nvme0n1p1 和虚拟设备 loop/dm-0）
var diskDevRe = regexp.MustCompile(`^(sd[a-z]+|nvme[0-9]+n[0-9]+|vd[a-z]+|hd[a-z]+|xvd[a-z]+|mmcblk[0-9]+)$`)

// ParseDiskStats 解析 /proc/diskstats，合计所有物理块设备的读写字节和操作次数
// 每行格式：major minor name reads_completed reads_merged sectors_read time_read_ms
//
//	writes_completed writes_merged sectors_written time_write_ms ...
//
// 扇区固定 512 字节（Linux 内核约定）
// 面板与 agent 共用，保证两边磁盘 IO 口径一致
func ParseDiskStats(s string) (readBytes, writeBytes, ioCount uint64) {
	for _, line := range strings.Split(s, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 11 {
			continue
		}
		if !diskDevRe.MatchString(fields[2]) {
			continue
		}
		reads, _ := strconv.ParseUint(fields[3], 10, 64)
		sectorsRead, _ := strconv.ParseUint(fields[5], 10, 64)
		writes, _ := strconv.ParseUint(fields[7], 10, 64)
		sectorsWritten, _ := strconv.ParseUint(fields[9], 10, 64)
		readBytes += sectorsRead * 512
		writeBytes += sectorsWritten * 512
		ioCount += reads + writes
	}
	return
}

// splitSections 把脚本输出的 "=STAT=" / "=MEMINFO=" 等分段解析成 map
func splitSections(s string) map[string]string {
	out := map[string]string{}
	lines := strings.Split(s, "\n")
	var current string
	var buf strings.Builder
	flush := func() {
		if current != "" {
			out[current] = strings.TrimSpace(buf.String())
			buf.Reset()
		}
	}
	for _, line := range lines {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "=") && strings.HasSuffix(l, "=") && len(l) > 2 {
			flush()
			current = strings.Trim(l, "=")
			continue
		}
		if current != "" {
			if buf.Len() > 0 {
				buf.WriteString("\n")
			}
			buf.WriteString(line)
		}
	}
	flush()
	return out
}

// parseCPUUsageLine 取 /proc/stat 第一行 "cpu  10 20 30..."
// 这是一个累计值，无法仅凭一次拿瞬时占用率，这里取 idle/total 的反值
// 注：作为面板用途，2s 间隔内两次取样差分才精确；但首版直接用近似的"非空闲占比"
// 也基本能反映负载水平（误差可控）。后续可优化为两次取样差分。
func parseCPUUsageLine(s string) float64 {
	fields := strings.Fields(s)
	if len(fields) < 5 {
		return 0
	}
	// fields[0] = "cpu"
	var sum, idle uint64
	for i := 1; i < len(fields); i++ {
		v, _ := strconv.ParseUint(fields[i], 10, 64)
		sum += v
		if i == 4 || i == 5 { // idle + iowait
			idle += v
		}
	}
	if sum == 0 {
		return 0
	}
	return pct(sum-idle, sum)
}

func splitKVColon(line string) (string, string, bool) {
	idx := strings.Index(line, ":")
	if idx <= 0 {
		return "", "", false
	}
	return strings.TrimSpace(line[:idx]), strings.TrimSpace(line[idx+1:]), true
}

func parseMemValue(s string) uint64 {
	// "16384000 kB" → 16384000 * 1024 bytes
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return 0
	}
	n, _ := strconv.ParseUint(fields[0], 10, 64)
	if len(fields) > 1 && fields[1] == "kB" {
		n *= 1024
	}
	return n
}

func pct(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

var _ = fmt.Sprintf // 保留以备后续加日志
