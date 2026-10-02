package localsys

import (
	"net"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/host"
	gmem "github.com/shirou/gopsutil/v4/mem"
)

// CollectOverview 采集本机系统概览（跨平台主流程）。
// 通用部分（CPU 使用率差分、内存 / 交换、uptime、主 IP）走 gopsutil；
// 平台差异由 overview_darwin / overview_windows / overview_linux 的钩子提供：
//   - fillOSIdentity / fillCPUIdentity / adjustMemUsed / fillLoadAvg
//   - listDisks / fillNetDiskCounters / fillSystemTemps
func CollectOverview() (*Overview, error) {
	o := &Overview{
		Arch:     runtime.GOARCH,
		Hostname: hostname(),
	}
	fillOSIdentity(o)
	fillCPUIdentity(o)
	fillMemory(o)
	fillLoadAvg(o)
	fillUptime(o)
	sampleCPUPercentInto(o)
	o.Disks = listDisks()
	o.IPAddress = primaryIPv4()
	o.PublicIP = publicIPCached()
	fillNetDiskCounters(o)
	o.Runtimes = detectRuntimes()
	fillSystemTemps(o)
	return o, nil
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return h
}

// fillMemory 内存与交换分区（gopsutil；darwin 的 MemUsed 保持 vm_stat 口径）。
func fillMemory(o *Overview) {
	if vm, err := gmem.VirtualMemory(); err == nil && vm.Total > 0 {
		o.MemTotal = vm.Total
		o.MemUsed = vm.Used
		adjustMemUsed(o)
		o.MemPercent = float64(o.MemUsed) / float64(o.MemTotal) * 100
	}
	if sw, err := gmem.SwapMemory(); err == nil && sw.Total > 0 {
		o.SwapTotal = sw.Total
		o.SwapUsed = sw.Used
		o.SwapPercent = float64(sw.Used) / float64(sw.Total) * 100
	}
}

func fillUptime(o *Overview) {
	if up, err := host.Uptime(); err == nil && up > 0 {
		o.Uptime = up
	}
}

// primaryIPv4 用一次 UDP「连接」借出实际出口接口的地址；不会真正发包。
func primaryIPv4() string {
	conn, err := net.Dial("udp4", "8.8.8.8:53")
	if err == nil {
		defer conn.Close()
		if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok && addr.IP.To4() != nil && !addr.IP.IsLoopback() {
			return addr.IP.String()
		}
	}
	return firstNonLoopbackIPv4()
}

// ---- CPU 使用率差分（跨平台，gopsutil cpu.Times） ----

type cpuTimesSample struct {
	busy  []float64
	total []float64
}

var (
	cpuSampleMu  sync.Mutex
	cpuSamplePre *cpuTimesSample
	cpuSampleAt  time.Time
)

const cpuSampleStale = 5 * time.Second

// sampleCPUPercentInto 差分每核累计时间得到整机与每核使用率；
// 有 P/E 拓扑时（fillCPUIdentity 已先行填充）按「先性能核、再能效核」聚簇。
// 首次调用或上次采样过期时短暂双采样，行为与旧平台实现一致。
func sampleCPUPercentInto(o *Overview) {
	cpuSampleMu.Lock()
	defer cpuSampleMu.Unlock()

	curBusy, curTotal, ok := readCPUBusyTotal()
	if !ok {
		return
	}
	now := time.Now()
	pre := cpuSamplePre
	stale := pre == nil || len(pre.busy) != len(curBusy) ||
		now.Sub(cpuSampleAt) > cpuSampleStale
	if stale {
		time.Sleep(150 * time.Millisecond)
		b2, t2, ok2 := readCPUBusyTotal()
		if !ok2 || len(b2) != len(curBusy) {
			return
		}
		pre = &cpuTimesSample{busy: curBusy, total: curTotal}
		curBusy, curTotal = b2, t2
	}

	n := len(curBusy)
	percents := make([]float64, n)
	var busySum, totalSum float64
	var perfBusy, perfTotal, effBusy, effTotal float64
	perfN, effN := o.PerfCores, o.EffCores
	clustered := perfN > 0 && effN > 0 && perfN+effN <= n
	for i := 0; i < n; i++ {
		db := curBusy[i] - pre.busy[i]
		dt := curTotal[i] - pre.total[i]
		if db < 0 {
			db = 0
		}
		if dt < 0 {
			dt = 0
		}
		percents[i] = busyPercent(db, dt)
		busySum += db
		totalSum += dt
		if clustered {
			switch {
			case i < perfN:
				perfBusy += db
				perfTotal += dt
			case i < perfN+effN:
				effBusy += db
				effTotal += dt
			}
		}
	}
	cpuSamplePre = &cpuTimesSample{busy: curBusy, total: curTotal}
	cpuSampleAt = now

	o.CPUCores = BuildCPUCoreStats(percents, perfN, effN)
	o.CPUPercent = busyPercent(busySum, totalSum)
	if clustered && perfTotal > 0 && effTotal > 0 {
		o.PerfCPUPercent = busyPercent(perfBusy, perfTotal)
		o.EffCPUPercent = busyPercent(effBusy, effTotal)
	}
}

func busyPercent(busy, total float64) float64 {
	if total <= 0 {
		return 0
	}
	p := busy / total * 100
	if p < 0 {
		return 0
	}
	if p > 100 {
		return 100
	}
	return p
}

// readCPUBusyTotal 读每核累计时间（秒）：busy = 总量 - idle - iowait。
// darwin 上字段恰为 user/system/nice/idle，busy 即 user+nice+system，
// 与旧 sysctl/host_processor_info 实现同口径（nice 计入使用）。
func readCPUBusyTotal() (busy, total []float64, ok bool) {
	times, err := cpu.Times(true)
	if err != nil || len(times) == 0 {
		return nil, nil, false
	}
	busy = make([]float64, len(times))
	total = make([]float64, len(times))
	for i, t := range times {
		all := t.Total()
		idle := t.Idle + t.Iowait
		total[i] = all
		b := all - idle
		if b < 0 {
			b = 0
		}
		busy[i] = b
	}
	return busy, total, true
}
