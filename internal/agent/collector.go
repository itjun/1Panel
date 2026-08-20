package agent

import (
	"fmt"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/monitor"

	"golang.org/x/sys/unix"
)

// Sample 一次核心指标采样，对应 raw_metrics 一行。
// 速率（KB/s）在采样时用相邻两次的计数器差分算好，面板离线期间的数据也不缺速率。
type Sample struct {
	TS                            int64   // Unix 秒
	CPUPercent                    float64 // 差分瞬时使用率（首次采样为累计近似）
	Load1, Load5, Load15          float64
	MemUsed, MemTotal             uint64
	SwapUsed, SwapTotal           uint64
	NetRxBytes, NetTxBytes        uint64 // 默认路由网卡累计收发（与面板 Overview 口径一致）
	NetRxKBps, NetTxKBps          float64
	DiskReadBytes, DiskWriteBytes uint64 // 物理块设备累计读写（扇区×512）
	DiskReadKBps, DiskWriteKBps   float64
	DiskIOCount                   uint64
	DiskUsed, DiskTotal           uint64 // 根分区容量（statfs）
}

// HostInfo 变化频率低的主机信息，定时刷新
type HostInfo struct {
	Hostname    string `json:"hostname"`
	Arch        string `json:"arch"`
	Kernel      string `json:"kernel"`
	OSRelease   string `json:"osRelease"`
	CPUModel    string `json:"cpuModel"`
	CPUCount    int    `json:"cpuCount"`
	IPAddress   string `json:"ipAddress"`
	Uptime      uint64 `json:"uptime"`      // 秒
	CollectedAt int64  `json:"collectedAt"` // 本信息采集时间（Unix 秒）
}

// MetricCollector 直读 /proc 采集核心指标，零 fork、微秒级开销。
// procRoot 可注入，便于用构造的目录内容做单元测试。
type MetricCollector struct {
	procRoot string

	mu       sync.Mutex
	lastCPU  *[10]uint64 // 上次 /proc/stat cpu 各列 jiffies
	lastNet  *[2]uint64  // 上次默认网卡 rx/tx
	lastDisk *[3]uint64  // 上次物理盘累计 [readBytes, writeBytes, ioCount]
	lastMono time.Time   // 上次采样时刻（单调时钟，算速率用）
	defDev   string      // 默认路由网卡名（缓存，定期重解析）
	defDevAt time.Time   // 上次解析 defDev 的时间
}

// NewMetricCollector procRoot 为空时默认 /proc
func NewMetricCollector(procRoot string) *MetricCollector {
	if procRoot == "" {
		procRoot = "/proc"
	}
	return &MetricCollector{procRoot: procRoot}
}

// Collect 读一轮 /proc 并与上次采样差分。出错时返回 error（调用方记事件后跳过本轮）。
func (mc *MetricCollector) Collect() (Sample, error) {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	now := time.Now()
	s := Sample{TS: now.Unix()}

	// ---- CPU：/proc/stat 第一行 ----
	statBytes, err := os.ReadFile(mc.procRoot + "/stat")
	if err != nil {
		return s, fmt.Errorf("读 /proc/stat: %w", err)
	}
	var curCPU *[10]uint64
	for _, line := range strings.Split(string(statBytes), "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			break
		}
		var vals [10]uint64
		for i := 1; i < len(fields) && i <= 10; i++ {
			v, _ := strconv.ParseUint(fields[i], 10, 64)
			vals[i-1] = v
		}
		curCPU = &vals
		break
	}
	if curCPU == nil {
		return s, fmt.Errorf("/proc/stat 缺少 cpu 汇总行")
	}
	if prev := mc.lastCPU; prev != nil && !mc.lastMono.IsZero() {
		var curSum, curIdle, prevSum, prevIdle uint64
		curIdle = curCPU[3] + curCPU[4] // idle + iowait（与面板差分口径一致）
		prevIdle = prev[3] + prev[4]
		for i := 0; i < 10; i++ {
			curSum += curCPU[i]
			prevSum += prev[i]
		}
		totalDelta := int64(curSum) - int64(prevSum)
		idleDelta := int64(curIdle) - int64(prevIdle)
		if totalDelta > 0 {
			usage := float64(totalDelta-idleDelta) / float64(totalDelta) * 100
			if usage < 0 {
				usage = 0
			}
			if usage > 100 {
				usage = 100
			}
			s.CPUPercent = usage
		}
	}
	if s.CPUPercent == 0 {
		// 首次采样（或差分异常）：退化为自启动累计近似（与面板 fallback 口径一致）
		var sum, idle uint64
		for i := 0; i < 10; i++ {
			sum += curCPU[i]
		}
		idle = curCPU[3] + curCPU[4]
		if sum > 0 {
			s.CPUPercent = float64(sum-idle) / float64(sum) * 100
		}
	}

	// ---- 内存 / Swap：/proc/meminfo ----
	memBytes, err := os.ReadFile(mc.procRoot + "/meminfo")
	if err != nil {
		return s, fmt.Errorf("读 /proc/meminfo: %w", err)
	}
	memTotal, memAvail, swapTotal, swapFree := uint64(0), uint64(0), uint64(0), uint64(0)
	for _, line := range strings.Split(string(memBytes), "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		n := parseMemValueKB(v)
		switch strings.TrimSpace(k) {
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
	s.MemTotal = memTotal
	s.MemUsed = memTotal - memAvail
	s.SwapTotal = swapTotal
	s.SwapUsed = swapTotal - swapFree

	// ---- 负载：/proc/loadavg ----
	loadBytes, err := os.ReadFile(mc.procRoot + "/loadavg")
	if err != nil {
		return s, fmt.Errorf("读 /proc/loadavg: %w", err)
	}
	if fields := strings.Fields(string(loadBytes)); len(fields) >= 3 {
		s.Load1, _ = strconv.ParseFloat(fields[0], 64)
		s.Load5, _ = strconv.ParseFloat(fields[1], 64)
		s.Load15, _ = strconv.ParseFloat(fields[2], 64)
	}

	// ---- 网络：默认路由网卡 /proc/net/dev ----
	// defDev 缓存 2 分钟重解析一次（路由变化能跟上，又不必每轮解析 route 表）
	if time.Since(mc.defDevAt) > 2*time.Minute {
		routeBytes, _ := os.ReadFile(mc.procRoot + "/net/route")
		mc.defDev = defaultRouteDev(string(routeBytes))
		mc.defDevAt = now
	}
	devBytes, err := os.ReadFile(mc.procRoot + "/net/dev")
	if err != nil {
		return s, fmt.Errorf("读 /proc/net/dev: %w", err)
	}
	rx, tx := monitor.ParseNetDev(string(devBytes), mc.defDev)
	s.NetRxBytes, s.NetTxBytes = rx, tx

	// ---- 磁盘 IO：/proc/diskstats 物理块设备合计 ----
	diskBytes, err := os.ReadFile(mc.procRoot + "/diskstats")
	if err != nil {
		return s, fmt.Errorf("读 /proc/diskstats: %w", err)
	}
	readBytes, writeBytes, ioCount := monitor.ParseDiskStats(string(diskBytes))
	s.DiskReadBytes, s.DiskWriteBytes, s.DiskIOCount = readBytes, writeBytes, ioCount

	// ---- 根分区容量：statfs ----
	var st unix.Statfs_t
	if err := unix.Statfs("/", &st); err == nil {
		s.DiskTotal = uint64(st.Blocks) * uint64(st.Bsize)
		s.DiskUsed = (uint64(st.Blocks) - uint64(st.Bfree)) * uint64(st.Bsize)
	}

	// ---- 差分速率（用单调时钟间隔；计数器回绕/重启表现为负 delta，归零处理） ----
	dt := now.Sub(mc.lastMono).Seconds()
	if dt > 0.1 && !mc.lastMono.IsZero() {
		if mc.lastNet != nil {
			s.NetRxKBps = rateKBps(int64(rx)-int64(mc.lastNet[0]), dt)
			s.NetTxKBps = rateKBps(int64(tx)-int64(mc.lastNet[1]), dt)
		}
		if mc.lastDisk != nil {
			s.DiskReadKBps = rateKBps(int64(readBytes)-int64(mc.lastDisk[0]), dt)
			s.DiskWriteKBps = rateKBps(int64(writeBytes)-int64(mc.lastDisk[1]), dt)
		}
	}

	mc.lastCPU = curCPU
	mc.lastNet = &[2]uint64{rx, tx}
	mc.lastDisk = &[3]uint64{readBytes, writeBytes, ioCount}
	mc.lastMono = now
	return s, nil
}

// rateKBps 字节增量折算 KB/s；负增量（回绕/重启）返回 0
func rateKBps(deltaBytes int64, dtSec float64) float64 {
	if deltaBytes <= 0 || dtSec <= 0 {
		return 0
	}
	return float64(deltaBytes) / dtSec / 1024
}

// parseMemValueKB 解析 meminfo 值字段，如 " 16384 kB" → 字节数
func parseMemValueKB(v string) uint64 {
	fields := strings.Fields(v)
	if len(fields) == 0 {
		return 0
	}
	n, _ := strconv.ParseUint(fields[0], 10, 64)
	return n * 1024 // meminfo 单位固定 kB
}

// defaultRouteDev 解析 /proc/net/route，返回默认路由（Destination 00000000）网卡名；
// 多条 default 取 Metric 最小者；无 default 返回空串（上层回退为全网卡合计）。
func defaultRouteDev(route string) string {
	best := ""
	bestMetric := int64(1<<62 - 1)
	for _, line := range strings.Split(route, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}
		if fields[1] != "00000000" { // Destination
			continue
		}
		metric, err := strconv.ParseInt(fields[6], 10, 64)
		if err != nil {
			continue
		}
		if metric < bestMetric {
			bestMetric = metric
			best = fields[0]
		}
	}
	return best
}

// CollectHostInfo 采集低频主机信息。procRoot 为空用 /proc。
func CollectHostInfo(procRoot string) HostInfo {
	if procRoot == "" {
		procRoot = "/proc"
	}
	info := HostInfo{CollectedAt: time.Now().Unix()}
	info.Hostname, _ = os.Hostname()

	// 内核版本：/proc/sys/kernel/osrelease（与 uname -r 同源）；
	// 架构：GOARCH 映射到 uname -m 的惯用写法，保持与面板 Overview 一致
	if b, err := os.ReadFile(procRoot + "/sys/kernel/osrelease"); err == nil {
		info.Kernel = strings.TrimSpace(string(b))
	}
	info.Arch = goArchToUname(runtime.GOARCH)

	// /etc/os-release 的 PRETTY_NAME
	if b, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if v, ok := strings.CutPrefix(strings.TrimSpace(line), "PRETTY_NAME="); ok {
				info.OSRelease = strings.Trim(strings.TrimSpace(v), `"`)
				break
			}
		}
	}

	// /proc/cpuinfo：核数 + 型号
	if b, err := os.ReadFile(procRoot + "/cpuinfo"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "processor") {
				info.CPUCount++
			}
			if info.CPUModel == "" {
				if _, v, ok := strings.Cut(line, ":"); ok && strings.HasPrefix(line, "model name") {
					info.CPUModel = strings.TrimSpace(v)
				}
			}
		}
	}

	// 出口 IP：UDP connect 不发包，仅让内核选路由拿本地地址
	if conn, err := net.DialTimeout("udp", "1.1.1.1:80", 2*time.Second); err == nil {
		if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
			info.IPAddress = addr.IP.String()
		}
		_ = conn.Close()
	}
	if info.IPAddress == "" {
		// 回退：第一个非 lo 的 IPv4 地址
		if ifaces, err := net.Interfaces(); err == nil {
			for _, iface := range ifaces {
				if iface.Name == "lo" || iface.Flags&net.FlagUp == 0 {
					continue
				}
				addrs, _ := iface.Addrs()
				for _, a := range addrs {
					if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLoopback() {
						info.IPAddress = ipn.IP.String()
						break
					}
				}
				if info.IPAddress != "" {
					break
				}
			}
		}
	}

	// uptime
	if b, err := os.ReadFile(procRoot + "/uptime"); err == nil {
		if fields := strings.Fields(string(b)); len(fields) > 0 {
			f, _ := strconv.ParseFloat(fields[0], 64)
			info.Uptime = uint64(f)
		}
	}
	return info
}

// goArchToUname 把 Go 编译架构名映射成 uname -m 的惯用写法
func goArchToUname(goarch string) string {
	switch goarch {
	case "amd64":
		return "x86_64"
	case "arm64":
		return "aarch64"
	case "386":
		return "i686"
	default:
		return goarch
	}
}
