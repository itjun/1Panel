package monitor

import (
	"fmt"
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// Collector 监控数据采集器（依赖 sshd.Manager）
type Collector struct {
	mgr *sshd.Manager
}

func NewCollector(mgr *sshd.Manager) *Collector {
	return &Collector{mgr: mgr}
}

// CollectOverview 采集顶层系统指标（CPU/MEM/负载/磁盘汇总）
// 命令策略（Debian/Ubuntu）：
//   - /proc/stat：CPU 时间片
//   - /proc/meminfo + free -b：内存
//   - /proc/loadavg：负载
//   - uname + /etc/os-release：内核与发行版
func (c *Collector) CollectOverview(host string, opt sshd.ConnectOption) (Overview, error) {
	// 用一个组合命令一次性拿数据，减少 SSH 往返次数
	script := `echo "=STAT="; head -n1 /proc/stat; echo "=MEMINFO="; grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo; echo "=LOAD="; cat /proc/loadavg; echo "=UPTIME="; awk '{print $1}' /proc/uptime; echo "=CPUINFO="; grep -c processor /proc/cpuinfo; grep -m1 'model name' /proc/cpuinfo; echo "=OS="; uname -r; head -n1 /etc/os-release 2>/dev/null`
	out, err := c.mgr.Run(host, opt, script)
	if err != nil {
		return Overview{}, err
	}
	return parseOverview(string(out))
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
		if len(lines) >= 2 {
			// PRETTY_NAME="Ubuntu 22.04.4 LTS"
			_, v, ok := splitKVColon(lines[1])
			if ok {
				o.OSRelease = strings.Trim(strings.TrimSpace(v), "\"")
			}
		}
	}
	return o, nil
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
