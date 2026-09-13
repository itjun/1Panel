//go:build darwin

package localsys

import (
	"bufio"
	"bytes"
	"fmt"
	"net"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// CollectOverview 采集本机系统概览。
func CollectOverview() (*Overview, error) {
	o := &Overview{
		Arch:     runtime.GOARCH,
		Hostname: hostname(),
		Kernel:   sysctl("kern.osrelease"),
	}
	o.ModelName = sysctl("hw.model")
	o.CPUModel = sysctl("machdep.cpu.brand_string")
	if o.CPUModel == "" {
		o.CPUModel = "Apple Silicon"
	}
	if n, err := strconv.Atoi(strings.TrimSpace(sysctl("hw.ncpu"))); err == nil {
		o.CPUCount = n
	}
	parseCPULevels(o)
	if mem, err := strconv.ParseUint(strings.TrimSpace(sysctl("hw.memsize")), 10, 64); err == nil {
		o.MemTotal = mem
	}

	parseSWVers(o)
	parseLoadAvg(o)
	parseBootTime(o)
	parseMemUsed(o)
	parseSwapUsage(o)
	cores, total, perf, eff := samplePerCPUPercents(o.PerfCores, o.EffCores)
	o.CPUCores = cores
	o.CPUPercent = total
	o.PerfCPUPercent = perf
	o.EffCPUPercent = eff
	o.Disks = listDisks()
	o.IPAddress = primaryIPv4()
	o.PublicIP = publicIPCached()
	fillNetDiskCounters(o)
	o.Runtimes = detectRuntimes()
	fillSystemTemps(o)

	if o.MemTotal > 0 {
		o.MemPercent = float64(o.MemUsed) / float64(o.MemTotal) * 100
	}
	if o.SwapTotal > 0 {
		o.SwapPercent = float64(o.SwapUsed) / float64(o.SwapTotal) * 100
	}
	return o, nil
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return h
}

// parseCPULevels 读 hw.perflevel{N}，区分 Performance / Efficiency 逻辑核心数。
func parseCPULevels(o *Overview) {
	nLevels, _ := strconv.Atoi(strings.TrimSpace(sysctl("hw.nperflevels")))
	for i := 0; i < nLevels; i++ {
		prefix := fmt.Sprintf("hw.perflevel%d.", i)
		name := strings.ToLower(sysctl(prefix + "name"))
		n, err := strconv.Atoi(strings.TrimSpace(sysctl(prefix + "logicalcpu")))
		if err != nil || n <= 0 {
			n, err = strconv.Atoi(strings.TrimSpace(sysctl(prefix + "physicalcpu")))
		}
		if err != nil || n <= 0 {
			continue
		}
		switch {
		case strings.Contains(name, "performance"):
			o.PerfCores = n
		case strings.Contains(name, "efficiency"):
			o.EffCores = n
		}
	}
}

func sysctl(key string) string {
	out, err := exec.Command("sysctl", "-n", key).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func parseSWVers(o *Overview) {
	out, err := exec.Command("sw_vers").Output()
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if v, ok := strings.CutPrefix(line, "ProductName:"); ok {
			o.ProductName = strings.TrimSpace(v)
		}
		if v, ok := strings.CutPrefix(line, "ProductVersion:"); ok {
			o.ProductVer = strings.TrimSpace(v)
			o.OSRelease = o.ProductName + " " + o.ProductVer
		}
	}
	if o.OSRelease == "" && o.ProductVer != "" {
		o.OSRelease = "macOS " + o.ProductVer
	}
}

func parseLoadAvg(o *Overview) {
	raw := sysctl("vm.loadavg")
	// { 1.23 2.34 3.45 }
	re := regexp.MustCompile(`([\d.]+)\s+([\d.]+)\s+([\d.]+)`)
	m := re.FindStringSubmatch(raw)
	if len(m) == 4 {
		o.Load1, _ = strconv.ParseFloat(m[1], 64)
		o.Load5, _ = strconv.ParseFloat(m[2], 64)
		o.Load15, _ = strconv.ParseFloat(m[3], 64)
	}
}

func parseBootTime(o *Overview) {
	raw := sysctl("kern.boottime")
	// { sec = 1789004012, usec = 513549 } Thu Sep 10 ...
	re := regexp.MustCompile(`sec\s*=\s*(\d+)`)
	m := re.FindStringSubmatch(raw)
	if len(m) == 2 {
		sec, _ := strconv.ParseInt(m[1], 10, 64)
		if sec > 0 {
			up := time.Now().Unix() - sec
			if up > 0 {
				o.Uptime = uint64(up)
			}
		}
	}
}

// parseMemUsed：用 vm_stat 估算「已用」= (active + wired + compressed) * pageSize。
func parseMemUsed(o *Overview) {
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return
	}
	pageSize := uint64(16384)
	var active, wired, compressed uint64
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if v, ok := strings.CutPrefix(line, "Mach Virtual Memory Statistics: (page size of "); ok {
			v = strings.TrimSuffix(strings.TrimSpace(v), " bytes)")
			if n, err := strconv.ParseUint(v, 10, 64); err == nil && n > 0 {
				pageSize = n
			}
			continue
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		val = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(val), "."))
		n, _ := strconv.ParseUint(val, 10, 64)
		switch strings.TrimSpace(key) {
		case "Pages active":
			active = n
		case "Pages wired down":
			wired = n
		case "Pages occupied by compressor":
			compressed = n
		}
	}
	o.MemUsed = (active + wired + compressed) * pageSize
}

// parseSwapUsage 解析 `sysctl vm.swapusage`。
func parseSwapUsage(o *Overview) {
	raw := sysctl("vm.swapusage")
	total, used, ok := ParseSwapUsage(raw)
	if !ok {
		return
	}
	o.SwapTotal = total
	o.SwapUsed = used
}

func listDisks() []DiskInfo {
	var disks []DiskInfo
	// 先放物理 APFS 容器（环图汇总用，避免多卷重复累计）
	disks = append(disks, listAPFSContainers()...)
	disks = append(disks, listMountDisks()...)
	return disks
}

func listMountDisks() []DiskInfo {
	out, err := exec.Command("df", "-k", "-l").Output()
	if err != nil {
		return nil
	}
	var disks []DiskInfo
	sc := bufio.NewScanner(bytes.NewReader(out))
	first := true
	for sc.Scan() {
		line := sc.Text()
		if first {
			first = false
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue
		}
		mount := fields[len(fields)-1]
		if shouldSkipMount(mount) {
			continue
		}
		device := fields[0]
		if !strings.HasPrefix(device, "/dev/") && mount != "/" {
			continue
		}
		totalK, _ := strconv.ParseUint(fields[1], 10, 64)
		usedK, _ := strconv.ParseUint(fields[2], 10, 64)
		availK, _ := strconv.ParseUint(fields[3], 10, 64)
		total := totalK * 1024
		used := usedK * 1024
		avail := availK * 1024
		// 与文案「已用 / 总量」一致：用 used/total，不用 df Capacity%
		//（Capacity 是 used/(used+avail)，APFS 上会明显偏高）
		var pct float64
		if total > 0 {
			pct = float64(used) / float64(total) * 100
		}
		disks = append(disks, DiskInfo{
			Mount:      mount,
			Device:     device,
			Filesystem: device,
			FSType:     "apfs",
			Total:      total,
			Used:       used,
			Free:       avail,
			Avail:      avail,
			Percent:    pct,
			Kind:       "mount",
		})
	}
	return disks
}

func shouldSkipMount(mount string) bool {
	switch {
	case mount == "/dev":
		return true
	case strings.HasPrefix(mount, "/System/Volumes/Preboot"),
		strings.HasPrefix(mount, "/System/Volumes/VM"),
		strings.HasPrefix(mount, "/System/Volumes/Update"),
		strings.HasPrefix(mount, "/System/Volumes/xarts"),
		strings.HasPrefix(mount, "/System/Volumes/iSCPreboot"),
		strings.HasPrefix(mount, "/System/Volumes/Hardware"),
		strings.HasPrefix(mount, "/Volumes/Recovery"),
		strings.HasPrefix(mount, "/private/var/vm"):
		return true
	default:
		return false
	}
}

// listAPFSContainers 解析 diskutil apfs list，每个容器一条 kind=disk。
func listAPFSContainers() []DiskInfo {
	out, err := exec.Command("diskutil", "apfs", "list").Output()
	if err != nil {
		return nil
	}
	return ParseAPFSContainers(string(out))
}

// ParseAPFSContainers 解析 diskutil apfs list 文本（供单测）。
func ParseAPFSContainers(raw string) []DiskInfo {
	var disks []DiskInfo
	var cur *DiskInfo
	flush := func() {
		if cur != nil && cur.Total > 0 {
			if cur.Percent == 0 && cur.Total > 0 {
				cur.Percent = float64(cur.Used) / float64(cur.Total) * 100
			}
			disks = append(disks, *cur)
		}
		cur = nil
	}
	sc := bufio.NewScanner(strings.NewReader(raw))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(line, "+-- Container ") || strings.HasPrefix(line, "Container ") {
			flush()
			// +-- Container disk3 UUID
			fields := strings.Fields(line)
			name := ""
			for _, f := range fields {
				if strings.HasPrefix(f, "disk") {
					name = f
					break
				}
			}
			cur = &DiskInfo{
				Mount:      "",
				Device:     name,
				Filesystem: name,
				FSType:     "apfs",
				Kind:       "disk",
			}
			continue
		}
		if cur == nil {
			continue
		}
		if v, ok := cutAfter(line, "APFS Container Reference:"); ok {
			cur.Device = v
			cur.Filesystem = v
			continue
		}
		if v, ok := cutAfter(line, "Size (Capacity Ceiling):"); ok {
			cur.Total = parseBytesField(v)
			continue
		}
		if v, ok := cutAfter(line, "Capacity In Use By Volumes:"); ok {
			cur.Used = parseBytesField(v)
			continue
		}
		if v, ok := cutAfter(line, "Capacity Not Allocated:"); ok {
			cur.Free = parseBytesField(v)
			cur.Avail = cur.Free
		}
	}
	flush()
	return disks
}

func cutAfter(line, prefix string) (string, bool) {
	if !strings.HasPrefix(line, prefix) {
		return "", false
	}
	return strings.TrimSpace(strings.TrimPrefix(line, prefix)), true
}

// parseBytesField 取 "494384795648 B (494.4 GB)" 的字节数。
func parseBytesField(s string) uint64 {
	s = strings.TrimSpace(s)
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return 0
	}
	n, err := strconv.ParseUint(fields[0], 10, 64)
	if err != nil {
		return 0
	}
	return n
}

func primaryIPv4() string {
	out, err := exec.Command("route", "-n", "get", "default").Output()
	if err != nil {
		return firstNonLoopbackIPv4()
	}
	iface := ""
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if v, ok := strings.CutPrefix(line, "interface:"); ok {
			iface = strings.TrimSpace(v)
			break
		}
	}
	if iface == "" {
		return firstNonLoopbackIPv4()
	}
	ipOut, err := exec.Command("ipconfig", "getifaddr", iface).Output()
	if err != nil {
		return firstNonLoopbackIPv4()
	}
	ip := strings.TrimSpace(string(ipOut))
	if ip != "" {
		return ip
	}
	return firstNonLoopbackIPv4()
}

func firstNonLoopbackIPv4() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			ipNet, ok := a.(*net.IPNet)
			if !ok || ipNet.IP.To4() == nil {
				continue
			}
			return ipNet.IP.String()
		}
	}
	return ""
}

func detectRuntimes() []Runtime {
	names := []string{"java", "go", "python3", "node", "bun"}
	var out []Runtime
	for _, name := range names {
		path, err := exec.LookPath(name)
		if err != nil {
			if name == "python3" {
				path, err = exec.LookPath("python")
				if err != nil {
					continue
				}
				name = "python"
			} else {
				continue
			}
		}
		ver := runtimeVersion(name, path)
		display := name
		if display == "python3" {
			display = "python"
		}
		out = append(out, Runtime{Name: display, Version: ver, Path: path})
	}
	return out
}

func runtimeVersion(name, path string) string {
	var cmd *exec.Cmd
	switch name {
	case "java":
		cmd = exec.Command(path, "-version")
	case "go":
		cmd = exec.Command(path, "version")
	case "node", "bun":
		cmd = exec.Command(path, "-v")
	default:
		cmd = exec.Command(path, "--version")
	}
	out, err := cmd.CombinedOutput()
	if err != nil && len(out) == 0 {
		return ""
	}
	line := strings.TrimSpace(strings.Split(string(out), "\n")[0])
	re := regexp.MustCompile(`(\d+\.\d+(?:\.\d+)?)`)
	m := re.FindStringSubmatch(line)
	if len(m) >= 2 {
		return m[1]
	}
	return line
}
