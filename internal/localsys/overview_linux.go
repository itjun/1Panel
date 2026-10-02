//go:build linux

package localsys

import (
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/shirou/gopsutil/v4/cpu"
	gdisk "github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	gnet "github.com/shirou/gopsutil/v4/net"
)

// fillOSIdentity Linux：/etc/os-release + uname + DMI 机型。
func fillOSIdentity(o *Overview) {
	rel := readOSRelease()
	o.ProductName = rel["NAME"]
	o.ProductVer = rel["VERSION_ID"]
	o.OSRelease = rel["PRETTY_NAME"]
	if o.OSRelease == "" {
		parts := []string{o.ProductName, o.ProductVer}
		o.OSRelease = strings.TrimSpace(strings.Join(parts, " "))
	}
	if o.Kernel == "" {
		if k, err := host.KernelVersion(); err == nil {
			o.Kernel = k
		}
	}
	o.ModelName = readLinuxModelName()
}

// readLinuxModelName 机型：DMI 产品名，异常占位值视为无；ARM 单板机读设备树模型。
func readLinuxModelName() string {
	if b, err := os.ReadFile("/proc/device-tree/model"); err == nil {
		if m := strings.TrimSpace(strings.TrimRight(string(b), "\x00")); m != "" {
			return m
		}
	}
	b, err := os.ReadFile("/sys/class/dmi/id/product_name")
	if err != nil {
		return ""
	}
	m := strings.TrimSpace(string(b))
	switch m {
	case "", "To Be Filled By O.E.M.", "Default string", "System Product Name", "None":
		return ""
	}
	return m
}

// fillCPUIdentity Linux：/proc/cpuinfo（gopsutil）；ARM 上无 model name，回退机型名。
func fillCPUIdentity(o *Overview) {
	o.CPUCount = runtime.NumCPU()
	if infos, err := cpu.Info(); err == nil && len(infos) > 0 {
		o.CPUModel = strings.TrimSpace(infos[0].ModelName)
	}
	if o.CPUModel == "" {
		o.CPUModel = readLinuxModelName()
	}
}

// adjustMemUsed Linux：无覆盖（total − available 即常用口径）。
func adjustMemUsed(o *Overview) {}

// readOSRelease 读 /etc/os-release（兜底 /usr/lib/os-release）。
func readOSRelease() map[string]string {
	for _, p := range []string{"/etc/os-release", "/usr/lib/os-release"} {
		if b, err := os.ReadFile(p); err == nil {
			return ParseOSRelease(string(b))
		}
	}
	return map[string]string{}
}

// ParseOSRelease 解析 os-release 键值（供单测）；带引号的值去引号。
func ParseOSRelease(raw string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
			v = v[1 : len(v)-1]
		}
		out[strings.TrimSpace(k)] = v
	}
	return out
}

// ---- 磁盘 ----

// linuxBlock /sys/block 下的物理块设备。
type linuxBlock struct {
	Name      string // 如 sda、nvme0n1
	SizeBytes uint64
	Removable bool
	USB       bool
	Model     string
}

// listSysBlocks 枚举 /sys/block 的物理块设备（跳过 loop/ram/zram；dm/md 归并到物理盘后不再单列）。
func listSysBlocks() []linuxBlock {
	entries, err := os.ReadDir("/sys/block")
	if err != nil {
		return nil
	}
	var out []linuxBlock
	for _, e := range entries {
		name := e.Name()
		if skipBlockDevice(name) {
			continue
		}
		blk := linuxBlock{Name: name, SizeBytes: readSysUint("/sys/block/"+name+"/size") * 512}
		if v, err := os.ReadFile("/sys/block/" + name + "/removable"); err == nil && strings.TrimSpace(string(v)) == "1" {
			blk.Removable = true
		}
		// USB 盘：设备符号链接落在 /sys/devices/.../usb 下
		if link, err := os.Readlink("/sys/block/" + name); err == nil && strings.Contains(link, "/usb") {
			blk.USB = true
		}
		if b, err := os.ReadFile("/sys/block/" + name + "/device/model"); err == nil {
			blk.Model = strings.TrimSpace(string(b))
		}
		out = append(out, blk)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func skipBlockDevice(name string) bool {
	if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "zram") ||
		strings.HasPrefix(name, "sr") || strings.HasPrefix(name, "fd") || strings.HasPrefix(name, "md") {
		return true
	}
	// dm-*（LVM/LUKS）：容量与 IO 都计入底层物理盘
	return strings.HasPrefix(name, "dm-")
}

func readSysUint(path string) uint64 {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	n, _ := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
	return n
}

// linuxBlockParent 找分区所属物理块设备（nvme0n1p2 → nvme0n1；sda3 → sda；mmcblk0p1 → mmcblk0）。
// 前缀后须紧跟数字（sda1）或 p+数字（nvme0n1p1），避免把 sdap1 误归到 sda；多个候选取最长。
// dm-*（LVM/LUKS）经 slaves 链回到底层分区再归并。
func linuxBlockParent(blocks []linuxBlock, devBase string) string {
	if strings.HasPrefix(devBase, "dm-") {
		if slaves, err := os.ReadDir("/sys/block/" + devBase + "/slaves"); err == nil && len(slaves) > 0 {
			devBase = slaves[0].Name()
		}
	}
	best := ""
	for _, b := range blocks {
		if devBase == b.Name {
			return b.Name
		}
		if !strings.HasPrefix(devBase, b.Name) {
			continue
		}
		if partitionBoundary(devBase[len(b.Name):]) && len(b.Name) > len(best) {
			best = b.Name
		}
	}
	return best
}

// partitionBoundary 分区后缀形态：数字（sda1）或 p+数字（nvme0n1p1）。
func partitionBoundary(rest string) bool {
	if rest == "" {
		return false
	}
	if rest[0] >= '0' && rest[0] <= '9' {
		return true
	}
	return len(rest) >= 2 && rest[0] == 'p' && rest[1] >= '0' && rest[1] <= '9'
}

// listDisks Linux：物理块设备 + 实际挂载分区归并（Kind: disk / mount）。
func listDisks() []DiskInfo {
	blocks := listSysBlocks()
	if len(blocks) == 0 {
		return nil
	}
	partitions, err := gdisk.Partitions(false)
	if err != nil {
		return nil
	}

	type physAgg struct {
		block    linuxBlock
		total    uint64
		used     uint64
		free     uint64
		avail    uint64
		fsType   string
		mounts   int
		external bool
	}
	byParent := map[string]*physAgg{}
	order := []string{}
	seenDev := map[string]bool{}

	var parts []DiskInfo
	for _, p := range partitions {
		devBase := filepath.Base(p.Device)
		if strings.HasPrefix(devBase, "loop") || strings.HasPrefix(devBase, "ram") || strings.HasPrefix(devBase, "zram") {
			continue
		}
		if seenDev[devBase] {
			continue // btrfs 子卷会同一设备挂多处，只计一次
		}
		if skipLinuxMount(p.Mountpoint) {
			continue
		}
		parent := linuxBlockParent(blocks, devBase)
		if parent == "" {
			continue
		}
		usage, err := gdisk.Usage(p.Mountpoint)
		if err != nil || usage.Total == 0 {
			continue
		}
		seenDev[devBase] = true
		blk := blockByName(blocks, parent)
		external := blk.Removable || blk.USB || isLinuxExternalMount(p.Mountpoint)

		agg, ok := byParent[parent]
		if !ok {
			agg = &physAgg{block: blk, external: external}
			byParent[parent] = agg
			order = append(order, parent)
		}
		agg.total += usage.Total
		agg.used += usage.Used
		agg.free += usage.Free
		agg.avail += usage.Free
		agg.mounts++
		if agg.fsType == "" {
			agg.fsType = p.Fstype
		}

		name := filepath.Base(strings.TrimRight(p.Mountpoint, "/"))
		if p.Mountpoint == "/" {
			name = "系统盘"
		}
		parts = append(parts, DiskInfo{
			Mount:      p.Mountpoint,
			Device:     p.Device,
			Filesystem: p.Device,
			FSType:     p.Fstype,
			Total:      usage.Total,
			Used:       usage.Used,
			Free:       usage.Free,
			Avail:      usage.Free,
			Percent:    usedPercentLinux(usage.Used, usage.Total),
			Kind:       "mount",
			Parent:     parent,
			Name:       name,
			External:   external,
		})
	}

	var physicals []DiskInfo
	for _, parent := range order {
		agg := byParent[parent]
		name := agg.block.Model
		if name == "" {
			name = parent
		}
		physicals = append(physicals, DiskInfo{
			Device:     parent,
			Filesystem: parent,
			FSType:     agg.fsType,
			Total:      agg.total,
			Used:       agg.used,
			Free:       agg.free,
			Avail:      agg.avail,
			Percent:    usedPercentLinux(agg.used, agg.total),
			Kind:       "disk",
			Parent:     parent,
			Name:       name,
			External:   agg.external,
		})
	}
	sort.Slice(parts, func(i, j int) bool { return parts[i].Mount < parts[j].Mount })
	return append(physicals, parts...)
}

func blockByName(blocks []linuxBlock, name string) linuxBlock {
	for _, b := range blocks {
		if b.Name == name {
			return b
		}
	}
	return linuxBlock{Name: name}
}

// skipLinuxMount 容器 / 快照 / 恢复等非用户存储挂载。
func skipLinuxMount(mount string) bool {
	switch {
	case strings.HasPrefix(mount, "/snap/"),
		strings.HasPrefix(mount, "/var/lib/docker/"),
		strings.HasPrefix(mount, "/var/lib/containers/"),
		strings.HasPrefix(mount, "/var/lib/kubelet/"):
		return true
	}
	return false
}

// isLinuxExternalMount 桌面环境自动挂载的 U 盘 / 移动硬盘。
func isLinuxExternalMount(mount string) bool {
	return strings.HasPrefix(mount, "/media/") || strings.HasPrefix(mount, "/run/media/")
}

func usedPercentLinux(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

// fillNetDiskCounters Linux：默认路由网卡的累计流量 + 物理块设备磁盘 IO 合计。
func fillNetDiskCounters(o *Overview) {
	o.NetRxBytes, o.NetTxBytes = linuxNetBytes()
	o.DiskReadBytes, o.DiskWriteBytes, o.DiskIOCount = linuxDiskIOTotals()
}

func linuxNetBytes() (rx, tx uint64) {
	counters, err := gnet.IOCounters(true)
	if err != nil || len(counters) == 0 {
		return 0, 0
	}
	_, iface := defaultRoute()
	byName := make(map[string]gnet.IOCountersStat, len(counters))
	for _, c := range counters {
		byName[c.Name] = c
	}
	if iface != "" {
		if c, ok := byName[iface]; ok {
			return c.BytesRecv, c.BytesSent
		}
	}
	for _, c := range counters {
		if skipNetDevLinux(c.Name) {
			continue
		}
		rx += c.BytesRecv
		tx += c.BytesSent
	}
	return rx, tx
}

// skipNetDevLinux 虚拟网口不计入兜底汇总（环回 / 容器网桥 / VPN 隧道）。
func skipNetDevLinux(name string) bool {
	n := strings.ToLower(name)
	switch {
	case n == "lo":
		return true
	}
	for _, p := range []string{"veth", "docker", "br-", "virbr", "wg", "tun", "tap", "zt", "tailscale"} {
		if strings.HasPrefix(n, p) {
			return true
		}
	}
	return false
}

// linuxDiskIOTotals 只统计物理块设备（dm 计入底层盘，分区与整盘重复不计）。
func linuxDiskIOTotals() (read, write, ops uint64) {
	io, err := gdisk.IOCounters()
	if err != nil || len(io) == 0 {
		return 0, 0, 0
	}
	blocks := listSysBlocks()
	whole := make(map[string]bool, len(blocks))
	for _, b := range blocks {
		whole[b.Name] = true
	}
	for name, c := range io {
		if !whole[name] {
			continue
		}
		read += c.ReadBytes
		write += c.WriteBytes
		ops += c.ReadCount + c.WriteCount
	}
	return read, write, ops
}
