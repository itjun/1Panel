//go:build !windows

package localsys

import "github.com/shirou/gopsutil/v4/load"

// fillLoadAvg Unix 负载（darwin sysctl vm.loadavg / linux /proc/loadavg，gopsutil 同源）。
// Windows 无 loadavg，由 overview_windows.go 用处理器队列长度近似。
func fillLoadAvg(o *Overview) {
	avg, err := load.Avg()
	if err != nil {
		return
	}
	o.Load1 = avg.Load1
	o.Load5 = avg.Load5
	o.Load15 = avg.Load15
}
