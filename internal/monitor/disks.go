package monitor

import (
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// diskCollectScript 本机/远端统一采集脚本。
// 可选命令（lvs/zpool）必须 || true：缺包时 exit 127，否则 CollectDisks 整段失败，
// 前端 Promise.all(overview, disks) 会把整机打成「失败」。
func diskCollectScript() string {
	return strings.Join([]string{
		`echo '###DF###'`,
		`df -B1 -T -x tmpfs -x devtmpfs -x squashfs -x overlay -x overlay2 2>/dev/null`,
		`echo '###LSBLK###'`,
		`lsblk -b -d -n -o NAME,SIZE,TYPE 2>/dev/null`,
		`echo '###LVS###'`,
		`lvs --noheadings --units b --nosuffix -o lv_name,lv_attr,lv_size,data_percent 2>/dev/null || true`,
		`echo '###ZPOOL###'`,
		`zpool list -Hp -o name,size,allocated,free 2>/dev/null || true`,
	}, "; ")
}

// CollectDisks 采集磁盘容量：挂载分区（df）+ 物理盘/存储池（lsblk / LVM thin / ZFS）
// 前端汇总优先用 kind=disk（真实块设备或 zpool），分区列表用 kind=mount。
func (c *Collector) CollectDisks(host string, opt sshd.ConnectOption) ([]DiskInfo, error) {
	cmd := diskCollectScript()
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	sections := splitDiskSections(string(out))
	merged := mergeDiskInfos(sections["DF"], sections["LSBLK"], sections["LVS"], sections["ZPOOL"])
	filtered := merged[:0]
	for _, d := range merged {
		if d.Kind != "disk" && shouldSkipMountEntry(d) {
			continue
		}
		filtered = append(filtered, d)
	}
	return filtered, nil
}

func splitDiskSections(s string) map[string]string {
	out := map[string]string{}
	cur := ""
	var b strings.Builder
	flush := func() {
		if cur == "" {
			return
		}
		out[cur] = strings.TrimSpace(b.String())
		b.Reset()
	}
	for _, line := range strings.Split(s, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "###") && strings.HasSuffix(trim, "###") {
			flush()
			cur = strings.Trim(trim, "#")
			continue
		}
		if cur != "" {
			b.WriteString(line)
			b.WriteByte('\n')
		}
	}
	flush()
	return out
}

// mergeDiskInfos 合并 df / lsblk / lvs / zpool。
// - 有 zpool 时：kind=disk 用池容量（避免与成员盘重复累计）
// - 否则：kind=disk 用 lsblk 物理盘；已用 = 挂载已用 + LVM thin 已分配
func mergeDiskInfos(dfOut, lsblkOut, lvsOut, zpoolOut string) []DiskInfo {
	mounts := parseDisks(dfOut)
	for i := range mounts {
		mounts[i].Kind = "mount"
	}

	zpools := parseZpools(zpoolOut)
	if len(zpools) > 0 {
		out := make([]DiskInfo, 0, len(mounts)+len(zpools))
		for _, z := range zpools {
			out = append(out, z)
		}
		out = append(out, mounts...)
		return out
	}

	phys := parseLsblkDisks(lsblkOut)
	thinUsed := parseLVSThinUsed(lvsOut)
	fsUsed := sumMountUsed(mounts)
	usedBudget := fsUsed + thinUsed

	out := make([]DiskInfo, 0, len(mounts)+len(phys))
	if len(phys) == 0 {
		// 无 lsblk 时退回仅挂载（旧行为）
		return mounts
	}

	var physTotal uint64
	for _, p := range phys {
		physTotal += p.Size
	}
	if usedBudget > physTotal {
		usedBudget = physTotal
	}

	// 多盘时按容量占比分摊已用（无法精确映射到 PV 时的近似）
	var allocated uint64
	for i, p := range phys {
		var used uint64
		if i == len(phys)-1 {
			used = usedBudget - allocated
		} else if physTotal > 0 {
			used = usedBudget * p.Size / physTotal
			allocated += used
		}
		avail := uint64(0)
		if p.Size > used {
			avail = p.Size - used
		}
		pct := 0.0
		if p.Size > 0 {
			pct = float64(used) / float64(p.Size) * 100
		}
		out = append(out, DiskInfo{
			Filesystem: "/dev/" + p.Name,
			FSType:     "disk",
			Mount:      p.Name,
			Total:      p.Size,
			Used:       used,
			Avail:      avail,
			Percent:    pct,
			Kind:       "disk",
		})
	}
	out = append(out, mounts...)
	return out
}

type lsblkDisk struct {
	Name string
	Size uint64
}

func parseLsblkDisks(s string) []lsblkDisk {
	var out []lsblkDisk
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		if fields[2] != "disk" {
			continue
		}
		size, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil || size == 0 {
			continue
		}
		out = append(out, lsblkDisk{Name: fields[0], Size: size})
	}
	return out
}

// parseLVSThinUsed 统计 thin pool 已分配字节（lv_attr 首字符为 t）
// 行格式：name attr size [data_percent]
func parseLVSThinUsed(s string) uint64 {
	var total uint64
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		attr := fields[1]
		if attr == "" || (attr[0] != 't' && attr[0] != 'T') {
			continue
		}
		size, err := strconv.ParseUint(fields[2], 10, 64)
		if err != nil || size == 0 {
			continue
		}
		pct := 0.0
		if len(fields) >= 4 {
			pct, _ = strconv.ParseFloat(fields[3], 64)
		}
		if pct < 0 {
			pct = 0
		}
		if pct > 100 {
			pct = 100
		}
		total += uint64(float64(size) * pct / 100.0)
	}
	return total
}

func parseZpools(s string) []DiskInfo {
	var out []DiskInfo
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		size, err1 := strconv.ParseUint(fields[1], 10, 64)
		alloc, err2 := strconv.ParseUint(fields[2], 10, 64)
		free, err3 := strconv.ParseUint(fields[3], 10, 64)
		if err1 != nil || err2 != nil || err3 != nil || size == 0 {
			continue
		}
		pct := float64(alloc) / float64(size) * 100
		out = append(out, DiskInfo{
			Filesystem: fields[0],
			FSType:     "zfs",
			Mount:      fields[0],
			Total:      size,
			Used:       alloc,
			Avail:      free,
			Percent:    pct,
			Kind:       "disk",
		})
	}
	return out
}

func sumMountUsed(mounts []DiskInfo) uint64 {
	byFs := map[string]uint64{}
	for _, d := range mounts {
		key := d.Filesystem
		if key == "" {
			key = d.Mount
		}
		if prev, ok := byFs[key]; !ok || d.Used > prev {
			byFs[key] = d.Used
		}
	}
	var total uint64
	for _, u := range byFs {
		total += u
	}
	return total
}

// shouldSkipMountEntry 隐藏容器挂载、固件/虚拟伪文件系统（易误触发「可用不足」告警）
func shouldSkipMountEntry(d DiskInfo) bool {
	if shouldSkipMount(d.Mount) {
		return true
	}
	if strings.HasPrefix(d.Mount, "/sys/") || d.Mount == "/etc/pve" {
		return true
	}
	switch strings.ToLower(d.FSType) {
	case "efivarfs", "rpc_pipefs", "binfmt_misc", "tracefs", "debugfs",
		"securityfs", "devpts", "proc", "sysfs", "cgroup", "cgroup2", "configfs", "pstore":
		return true
	}
	return false
}

// shouldSkipMount 判断一个挂载点是否应该从磁盘列表中隐藏
// 隐藏：docker 容器、snap 包内部、kubelet/PodMAN 等
func shouldSkipMount(mount string) bool {
	skipPrefixes := []string{
		"/var/lib/docker/",     // docker 容器/卷/镜像
		"/var/lib/containers/", // podman
		"/var/lib/kubelet/",    // kubernetes
		"/var/lib/snapd/",      // snap
		"/snap/",               // snap 挂载
		"/run/containerd/",     // containerd
	}
	for _, p := range skipPrefixes {
		if strings.HasPrefix(mount, p) {
			return true
		}
	}
	return false
}

// parseDisks 解析 df -BT 输出（7 列：Filesystem Type 1B-blocks Used Avail Use% Mounted）
func parseDisks(s string) []DiskInfo {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) <= 1 {
		return nil
	}
	out := make([]DiskInfo, 0, len(lines)-1)
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		total, _ := strconv.ParseUint(fields[2], 10, 64)
		used, _ := strconv.ParseUint(fields[3], 10, 64)
		avail, _ := strconv.ParseUint(fields[4], 10, 64)
		pctRaw := strings.TrimSuffix(fields[5], "%")
		p, _ := strconv.ParseFloat(pctRaw, 64)
		out = append(out, DiskInfo{
			Filesystem: fields[0],
			FSType:     fields[1],
			Mount:      fields[6],
			Total:      total,
			Used:       used,
			Avail:      avail,
			Percent:    p,
			Kind:       "mount",
		})
	}
	return out
}
