//go:build windows

package localsys

import (
	"fmt"
	"runtime"
	"strconv"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// fillOSIdentity Windows：注册表版本（Win11 旧版兼容仍写 Windows 10，需替换）。
func fillOSIdentity(o *Overview) {
	ver := readWindowsVersion()
	o.OSRelease = ver.osReleaseText()
	o.ProductName = "Windows"
	o.ProductVer = strings.TrimSpace(ver.DisplayVersion)
	o.Kernel = ver.kernelText()
	o.ModelName = machineModelWin()
}

// fillCPUIdentity Windows：注册表 CPU 型号。
func fillCPUIdentity(o *Overview) {
	o.CPUModel = cpuModelWin()
	o.CPUCount = runtime.NumCPU()
}

// adjustMemUsed Windows：无覆盖（gopsutil 的 total − available 与原实现一致）。
func adjustMemUsed(o *Overview) {}

// fillLoadAvg Windows 无 Unix loadavg；用处理器队列长度近似 1 分钟负载。
func fillLoadAvg(o *Overview) {
	if q, ok := processorQueueLength(); ok {
		o.Load1 = q
	}
}

// ---- Windows 版本信息（注册表，不走 PowerShell） ----

type winVersionInfo struct {
	ProductName    string // 如 "Windows 10 专业版"（Win11 旧版兼容仍写 Windows 10）
	DisplayVersion string // 如 "23H2"；老系统为空
	Build          string // 如 "22631"
	UBR            string // 更新修订号，如 "4890"
	Major          int
	Minor          int
}

func readWindowsVersion() winVersionInfo {
	var v winVersionInfo
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return v
	}
	defer k.Close()
	v.ProductName, _, _ = k.GetStringValue("ProductName")
	v.DisplayVersion, _, _ = k.GetStringValue("DisplayVersion")
	v.Build, _, _ = k.GetStringValue("CurrentBuildNumber")
	if ubr, _, err := k.GetIntegerValue("UBR"); err == nil {
		v.UBR = strconv.FormatUint(ubr, 10)
	}
	if maj, _, err := k.GetIntegerValue("CurrentMajorVersionNumber"); err == nil {
		v.Major = int(maj)
	}
	if min, _, err := k.GetIntegerValue("CurrentMinorVersionNumber"); err == nil {
		v.Minor = int(min)
	}
	return v
}

// osReleaseText 组装展示名：build ≥ 22000 时注册表 ProductName 仍写 "Windows 10"，
// 需要替换成 Windows 11。
func (v winVersionInfo) osReleaseText() string {
	name := strings.TrimSpace(v.ProductName)
	if name == "" {
		name = "Windows"
	}
	if build, err := strconv.Atoi(strings.TrimSpace(v.Build)); err == nil && build >= 22000 {
		name = strings.Replace(name, "Windows 10", "Windows 11", 1)
	}
	parts := []string{name}
	if dv := strings.TrimSpace(v.DisplayVersion); dv != "" {
		parts = append(parts, dv)
	}
	return strings.Join(parts, " ")
}

func (v winVersionInfo) kernelText() string {
	maj, min := v.Major, v.Minor
	if maj == 0 {
		maj, min = 10, 0
	}
	build := strings.TrimSpace(v.Build)
	if build == "" {
		build = "0"
	}
	if v.UBR != "" {
		build += "." + v.UBR
	}
	return fmt.Sprintf("Windows NT %d.%d.%s", maj, min, build)
}

// ---- 磁盘 ----

const (
	driveRemovable = 2 // DRIVE_REMOVABLE（U 盘 / 移动硬盘，属外置盘）
	driveFixed     = 3 // DRIVE_FIXED
)

// eachFixedDrive 遍历所有本地固定盘根目录（如 C:\）；回调返回 false 提前结束。
func eachFixedDrive(fn func(root string, rootPtr *uint16) bool) {
	eachLocalDrive(func(root string, rootPtr *uint16, isRemovable bool) bool {
		if isRemovable {
			return true
		}
		return fn(root, rootPtr)
	})
}

// eachLocalDrive 遍历固定盘与可移动盘根目录；isRemovable 标记外置盘。
func eachLocalDrive(fn func(root string, rootPtr *uint16, isRemovable bool) bool) {
	bitmask, err := windows.GetLogicalDrives()
	if err != nil {
		return
	}
	for letter := 'A'; letter <= 'Z'; letter++ {
		if bitmask&(1<<uint(letter-'A')) == 0 {
			continue
		}
		root := string(letter) + `:\`
		rootPtr, err := windows.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		dt := windows.GetDriveType(rootPtr)
		if dt != driveFixed && dt != driveRemovable {
			continue
		}
		if !fn(root, rootPtr, dt == driveRemovable) {
			return
		}
	}
}

// listDisks 枚举本地固定盘与可移动盘卷；每卷自成一个「物理盘」。
func listDisks() []DiskInfo {
	var disks []DiskInfo
	eachLocalDrive(func(root string, rootPtr *uint16, isRemovable bool) bool {
		var freeCaller, total, free uint64
		if err := windows.GetDiskFreeSpaceEx(rootPtr, &freeCaller, &total, &free); err != nil {
			return true
		}
		used := total - free
		var pct float64
		if total > 0 {
			pct = float64(used) / float64(total) * 100
		}
		fsName := volumeFileSystem(rootPtr)
		label := volumeLabel(rootPtr)
		serial := volumeSerial(rootPtr)
		device := `\\.\` + root[:1] + ":"
		parent := fmt.Sprintf("vol%d", serial)
		// 展示名：卷标优先，否则「本地磁盘 C:」/「可移动磁盘 E:」
		name := label
		if name == "" {
			if isRemovable {
				name = "可移动磁盘 " + root[:2]
			} else {
				name = "本地磁盘 " + root[:2]
			}
		}
		disks = append(disks, DiskInfo{
			Mount:      root,
			Device:     device,
			Filesystem: device,
			FSType:     fsName,
			Total:      total,
			Used:       used,
			Free:       free,
			Avail:      free,
			Percent:    pct,
			Kind:       "disk",
			Parent:     parent,
			Name:       name,
			External:   isRemovable,
		})
		disks = append(disks, DiskInfo{
			Mount:      root,
			Device:     device,
			Filesystem: device,
			FSType:     fsName,
			Total:      total,
			Used:       used,
			Free:       free,
			Avail:      free,
			Percent:    pct,
			Kind:       "mount",
			Parent:     parent,
			Name:       name,
			External:   isRemovable,
		})
		return true
	})
	return disks
}

func volumeFileSystem(root *uint16) string {
	var fsBuf [64]uint16
	err := windows.GetVolumeInformation(root, nil, 0, nil, nil, nil,
		&fsBuf[0], uint32(len(fsBuf)))
	if err != nil {
		return ""
	}
	return windows.UTF16ToString(fsBuf[:])
}

// volumeLabel 读卷标（如「Windows」「数据」）；无卷标返回空串。
func volumeLabel(root *uint16) string {
	var buf [64]uint16
	err := windows.GetVolumeInformation(root, &buf[0], uint32(len(buf)), nil, nil, nil, nil, 0)
	if err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:])
}

func volumeSerial(root *uint16) uint32 {
	var serial uint32
	_ = windows.GetVolumeInformation(root, nil, 0, &serial, nil, nil, nil, 0)
	return serial
}

// fillNetDiskCounters Windows：GetIfTable2 汇总网卡 + NT 查询磁盘累计 IO。
func fillNetDiskCounters(o *Overview) {
	rx, tx := sumNetOctets()
	o.NetRxBytes = rx
	o.NetTxBytes = tx
	if read, write, ops, ok := ntSystemDiskIO(); ok {
		o.DiskReadBytes = read
		o.DiskWriteBytes = write
		o.DiskIOCount = ops
	}
}

// ---- 机型 / CPU 型号 ----

func machineModelWin() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`HARDWARE\DESCRIPTION\System\BIOS`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	manu, _, _ := k.GetStringValue("SystemManufacturer")
	product, _, _ := k.GetStringValue("SystemProductName")
	manu = strings.TrimSpace(manu)
	product = strings.TrimSpace(product)
	switch {
	case manu != "" && product != "":
		return manu + " " + product
	case product != "":
		return product
	default:
		return manu
	}
}

func cpuModelWin() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`HARDWARE\DESCRIPTION\System\CentralProcessor\0`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	name, _, _ := k.GetStringValue("ProcessorNameString")
	return strings.TrimSpace(name)
}
