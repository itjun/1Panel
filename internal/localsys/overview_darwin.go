//go:build darwin

package localsys

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
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
	containers := listAPFSContainers()
	mounts := listMountDisks()
	var need []string
	for _, c := range containers {
		need = append(need, c.Parent)
	}
	for _, m := range mounts {
		need = append(need, m.Parent)
	}
	kinds := cachedWholeDiskKinds(need)
	return BuildLocalDisks(containers, mounts, kinds)
}

// BuildLocalDisks 把 APFS 容器与 df 挂载归并为「物理盘(kind=disk) + 用户可见分区(kind=mount)」（供单测）。
// containers 的 Parent 须已是物理整盘（Physical Store 所在盘）；mounts 的 Parent 为设备所在盘（可能是 APFS 容器）。
// kinds 为 diskutil list 的整盘描述；为空（diskutil 失败）时一律按物理盘处理。
func BuildLocalDisks(containers, mounts []DiskInfo, kinds map[string]string) []DiskInfo {
	containerByRef := map[string]DiskInfo{}
	for _, c := range containers {
		containerByRef[c.Device] = c
	}

	var physicals []DiskInfo
	physIndex := map[string]int{}
	addToPhysical := func(key, fsType string, src DiskInfo) {
		i, ok := physIndex[key]
		if !ok {
			physicals = append(physicals, DiskInfo{
				Device:     key,
				Filesystem: key,
				FSType:     fsType,
				Kind:       "disk",
				Parent:     key,
				External:   isExternalWholeDisk(kinds, key),
			})
			i = len(physicals) - 1
			physIndex[key] = i
		}
		p := &physicals[i]
		p.Total += src.Total
		p.Used += src.Used
		p.Free += src.Free
		p.Avail += src.Avail
	}
	for _, c := range containers {
		if !isPhysicalWholeDisk(kinds, c.Parent) {
			continue
		}
		addToPhysical(c.Parent, "apfs", c)
	}

	var partitions []DiskInfo
	for _, m := range mounts {
		ref := m.Parent
		phys := ref
		c, inContainer := containerByRef[ref]
		if inContainer {
			phys = c.Parent
		}
		m.Parent = phys
		m.External = isExternalWholeDisk(kinds, phys)

		if m.Mount == "/" {
			// 根分区是只读系统快照（约 13GB）；按容器合并系统 + 数据，与访达「Macintosh HD」一致
			if inContainer {
				m.Device = "/dev/" + ref
				m.Filesystem = m.Device
				m.Total = c.Total
				m.Used = c.Used
				m.Free = c.Avail
				m.Avail = c.Avail
				m.Name = c.Name
			}
			if m.Name == "" {
				m.Name = "Macintosh HD"
			}
			m.Percent = usedPercent(m.Used, m.Total)
			partitions = append(partitions, m)
			continue
		}

		// 其余只保留 /Volumes/名称；/System/Volumes/*、模拟器、cryptex 等系统挂载不展示
		if !isExternalVolumeMount(m.Mount) {
			continue
		}
		m.Name = strings.TrimPrefix(m.Mount, "/Volumes/")
		if isPhysicalWholeDisk(kinds, phys) {
			// 非 APFS 外置盘（ExFAT 等）没有容器，按卷累加到物理盘
			if !inContainer {
				addToPhysical(phys, m.FSType, m)
			}
			if i, ok := physIndex[phys]; ok && physicals[i].Name == "" {
				physicals[i].Name = m.Name
			}
		} else {
			// 用户手动挂载的 dmg 等磁盘映像：列在分区里，但不算物理盘
			m.FSType = "磁盘映像"
		}
		partitions = append(partitions, m)
	}

	for i := range physicals {
		physicals[i].Percent = usedPercent(physicals[i].Used, physicals[i].Total)
	}
	return append(physicals, partitions...)
}

func usedPercent(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

func isPhysicalWholeDisk(kinds map[string]string, disk string) bool {
	if len(kinds) == 0 {
		return true
	}
	return strings.Contains(kinds[disk], "physical")
}

func isExternalWholeDisk(kinds map[string]string, disk string) bool {
	return strings.Contains(kinds[disk], "external")
}

const wholeDiskKindsTTL = time.Minute

var (
	wholeDiskMu     sync.Mutex
	wholeDiskKinds  map[string]string
	wholeDiskExpire time.Time
)

// cachedWholeDiskKinds 缓存 diskutil list 的整盘类型（盘少变动，避免每次轮询多跑一次）；
// need 里出现未知盘号（刚插入 U 盘 / 刚挂载 dmg）时立即刷新。
func cachedWholeDiskKinds(need []string) map[string]string {
	wholeDiskMu.Lock()
	defer wholeDiskMu.Unlock()
	stale := time.Now().After(wholeDiskExpire)
	if !stale {
		for _, k := range need {
			if _, ok := wholeDiskKinds[k]; !ok {
				stale = true
				break
			}
		}
	}
	if stale {
		out, err := exec.Command("diskutil", "list").Output()
		if err == nil {
			wholeDiskKinds = ParseDiskutilListKinds(string(out))
			wholeDiskExpire = time.Now().Add(wholeDiskKindsTTL)
		}
	}
	return wholeDiskKinds
}

var diskutilListHeaderRe = regexp.MustCompile(`^/dev/(disk\d+)\s+\(([^)]*)\):`)

// ParseDiskutilListKinds 解析 diskutil list 的整盘标题行（供单测）。
// "/dev/disk0 (internal, physical):" → disk0: "internal, physical"；
// 其他取值如 "external, physical"、"disk image"、"synthesized"。
func ParseDiskutilListKinds(raw string) map[string]string {
	kinds := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		m := diskutilListHeaderRe.FindStringSubmatch(strings.TrimSpace(line))
		if len(m) == 3 {
			kinds[m[1]] = m[2]
		}
	}
	return kinds
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
		fsType := "apfs"
		if strings.HasPrefix(mount, "/Volumes/") {
			fsType = "volume" // 外置卷；具体格式不必每次 diskutil
		}
		item := DiskInfo{
			Mount:      mount,
			Device:     device,
			Filesystem: device,
			FSType:     fsType,
			Total:      total,
			Used:       used,
			Free:       avail,
			Avail:      avail,
			Percent:    pct,
			Kind:       "mount",
			Parent:     DiskParentKey(device, mount),
		}
		disks = append(disks, item)
	}
	return disks
}

// DiskParentKey 从设备节点或挂载路径得到物理盘分组键。
// /dev/disk3s5、/dev/disk3s1s1 → disk3；无法解析时回退 device/mount。
func DiskParentKey(device, mount string) string {
	d := strings.TrimPrefix(strings.TrimSpace(device), "/dev/")
	if strings.HasPrefix(d, "disk") {
		i := len("disk")
		for i < len(d) && d[i] >= '0' && d[i] <= '9' {
			i++
		}
		if i > len("disk") {
			return d[:i]
		}
	}
	m := strings.TrimSpace(mount)
	if isExternalVolumeMount(m) {
		return m
	}
	if d != "" {
		return d
	}
	return m
}

// isExternalVolumeMount：用户挂载的外置卷（/Volumes/名称），排除系统恢复卷
func isExternalVolumeMount(mount string) bool {
	if !strings.HasPrefix(mount, "/Volumes/") {
		return false
	}
	if mount == "/Volumes/Recovery" {
		return false
	}
	name := strings.TrimPrefix(mount, "/Volumes/")
	return name != "" && !strings.Contains(name, "/")
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
		strings.HasPrefix(mount, "/private/var/vm"),
		// iOS/visionOS 模拟器 cryptex 临时盘，不是用户物理存储
		strings.Contains(mount, "/com.apple.security.cryptexd/"),
		strings.Contains(mount, "SimulatorRuntime"):
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
// 注意：非末尾容器的行带 "|" 树形前缀，必须剥掉才能匹配字段。
// 模拟器 / disk image 容器不进入 kind=disk（避免顶部环图被 18GB 临时盘带歪）。
// Parent 取 Physical Store 所在整盘（disk3 → disk0）；Name 取 System 角色卷名（如 Macintosh HD）。
func ParseAPFSContainers(raw string) []DiskInfo {
	var disks []DiskInfo
	var cur *DiskInfo
	skip := false
	storeSeen := false
	systemVolume := false
	flush := func() {
		if cur != nil && cur.Total > 0 && !skip {
			if cur.Percent == 0 && cur.Total > 0 {
				cur.Percent = float64(cur.Used) / float64(cur.Total) * 100
			}
			disks = append(disks, *cur)
		}
		cur = nil
		skip = false
		storeSeen = false
		systemVolume = false
	}
	sc := bufio.NewScanner(strings.NewReader(raw))
	for sc.Scan() {
		line := normalizeDiskutilLine(sc.Text())
		if strings.HasPrefix(line, "+-- Container ") || strings.HasPrefix(line, "Container ") {
			flush()
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
				Parent:     name,
			}
			continue
		}
		if cur == nil {
			continue
		}
		if v, ok := cutAfter(line, "APFS Container Reference:"); ok {
			cur.Device = v
			cur.Filesystem = v
			if !storeSeen {
				cur.Parent = v
			}
			continue
		}
		// Fusion 等多 Physical Store 时取第一个
		if v, ok := cutAfter(line, "APFS Physical Store Disk:"); ok {
			if !storeSeen {
				cur.Parent = DiskParentKey(v, "")
				storeSeen = true
			}
			continue
		}
		if v, ok := cutAfter(line, "APFS Volume Disk (Role):"); ok {
			systemVolume = strings.HasSuffix(v, "(System)")
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
			continue
		}
		// 卷名含 Simulator → 整容器视为临时盘，不进物理汇总
		if v, ok := cutAfter(line, "Name:"); ok {
			name := strings.TrimSpace(v)
			if i := strings.Index(name, " ("); i > 0 {
				name = name[:i]
			}
			if strings.Contains(name, "Simulator") {
				skip = true
			}
			if systemVolume && cur.Name == "" {
				cur.Name = name
			}
			systemVolume = false
		}
	}
	flush()
	return disks
}

// normalizeDiskutilLine 去掉 diskutil 树形输出的 "|" 前缀与两侧空白。
func normalizeDiskutilLine(s string) string {
	s = strings.TrimSpace(s)
	for strings.HasPrefix(s, "|") {
		s = strings.TrimSpace(strings.TrimPrefix(s, "|"))
	}
	return s
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

// detectRuntimes / runtimeVersion / firstNonLoopbackIPv4 为跨平台实现，
// 已移至 runtimes.go 供 macOS 与 Windows 共用。
