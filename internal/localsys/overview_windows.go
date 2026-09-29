//go:build windows

package localsys

import (
	"fmt"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// x/sys 未封装的 kernel32 入口。
var (
	modKernel32             = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalMemoryStatusEx = modKernel32.NewProc("GlobalMemoryStatusEx")
	procGetTickCount64       = modKernel32.NewProc("GetTickCount64")
)

// memoryStatusEx 对应 MEMORYSTATUSEX（x64）。
type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func globalMemoryStatus() (*memoryStatusEx, bool) {
	ms := memoryStatusEx{Length: uint32(unsafe.Sizeof(memoryStatusEx{}))}
	r0, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&ms)))
	if r0 == 0 {
		return nil, false
	}
	return &ms, true
}

func tickCount64() uint64 {
	r0, _, _ := procGetTickCount64.Call()
	return uint64(r0)
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

// ---- CPU 使用率差分采样（与 macOS 版同思路） ----

type winCPUTicks struct {
	idle   []uint64
	kernel []uint64
	user   []uint64
}

var (
	winCPUMu     sync.Mutex
	winCPUPrev   winCPUTicks
	winCPUPrevAt time.Time
	winCPUPrevOK bool
)

func ticksBusyPercent(dIdle, dKernel, dUser uint64) float64 {
	total := dKernel + dUser // KernelTime 已包含 IdleTime
	if total == 0 {
		return 0
	}
	busy := int64(dKernel) - int64(dIdle) + int64(dUser)
	if busy < 0 {
		busy = 0
	}
	pct := float64(busy) / float64(total) * 100
	if pct > 100 {
		pct = 100
	}
	return pct
}

// sampleCPUPercentsWin 返回每核使用率与整机使用率；首次调用会短暂双采样。
func sampleCPUPercentsWin() (cores []CPUCoreStat, total float64) {
	winCPUMu.Lock()
	defer winCPUMu.Unlock()

	idle, kernel, user, err := ntReadPerCPUTicks()
	if err != nil || len(idle) == 0 {
		return nil, 0
	}
	now := time.Now()
	if !winCPUPrevOK || len(winCPUPrev.idle) != len(idle) ||
		now.Sub(winCPUPrevAt) > 5*time.Second {
		winCPUPrev = winCPUTicks{idle: idle, kernel: kernel, user: user}
		winCPUPrevAt = now
		winCPUPrevOK = true
		time.Sleep(150 * time.Millisecond)
		idle2, kernel2, user2, err2 := ntReadPerCPUTicks()
		if err2 != nil || len(idle2) != len(idle) {
			return nil, 0
		}
		idle, kernel, user = idle2, kernel2, user2
	}

	percents := make([]float64, len(idle))
	var dIdleAll, dKernelAll, dUserAll uint64
	for i := range idle {
		dIdle := idle[i] - winCPUPrev.idle[i]
		dKernel := kernel[i] - winCPUPrev.kernel[i]
		dUser := user[i] - winCPUPrev.user[i]
		percents[i] = ticksBusyPercent(dIdle, dKernel, dUser)
		dIdleAll += dIdle
		dKernelAll += dKernel
		dUserAll += dUser
	}
	winCPUPrev = winCPUTicks{idle: idle, kernel: kernel, user: user}
	winCPUPrevAt = now

	cores = BuildCPUCoreStats(percents, 0, 0)
	return cores, ticksBusyPercent(dIdleAll, dKernelAll, dUserAll)
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

// listDisksWin 枚举本地固定盘与可移动盘卷；每卷自成一个「物理盘」。
func listDisksWin() []DiskInfo {
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

// ---- 主 IP ----

func primaryIPv4Win() string {
	// 用一次 UDP「连接」借出实际出口接口的地址；不会真正发包。
	conn, err := net.Dial("udp4", "8.8.8.8:53")
	if err == nil {
		defer conn.Close()
		if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok && addr.IP.To4() != nil && !addr.IP.IsLoopback() {
			return addr.IP.String()
		}
	}
	return firstNonLoopbackIPv4()
}

// ---- 机型 ----

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

// CollectOverview 采集本机系统概览（Windows）。
func CollectOverview() (*Overview, error) {
	o := &Overview{
		Arch:     runtime.GOARCH,
		Hostname: hostname(),
	}
	ver := readWindowsVersion()
	o.OSRelease = ver.osReleaseText()
	o.ProductName = "Windows"
	o.ProductVer = strings.TrimSpace(ver.DisplayVersion)
	o.Kernel = ver.kernelText()
	o.CPUModel = cpuModelWin()
	o.ModelName = machineModelWin()
	o.CPUCount = runtime.NumCPU()

	if ms, ok := globalMemoryStatus(); ok {
		o.MemTotal = ms.TotalPhys
		o.MemUsed = ms.TotalPhys - ms.AvailPhys
		o.MemPercent = float64(o.MemUsed) / float64(o.MemTotal) * 100
	}
	if total, used, ok := ntPageFileUsage(); ok {
		o.SwapTotal = total
		o.SwapUsed = used
		o.SwapPercent = float64(used) / float64(total) * 100
	}

	// Windows 无 Unix loadavg；用处理器队列长度近似 1 分钟负载
	if q, ok := processorQueueLength(); ok {
		o.Load1 = q
	}

	o.Uptime = tickCount64() / 1000

	cores, total := sampleCPUPercentsWin()
	o.CPUCores = cores
	o.CPUPercent = total

	o.Disks = listDisksWin()
	o.IPAddress = primaryIPv4Win()
	o.PublicIP = publicIPCached()

	rx, tx := sumNetOctets()
	o.NetRxBytes = rx
	o.NetTxBytes = tx
	if read, write, ops, ok := ntSystemDiskIO(); ok {
		o.DiskReadBytes = read
		o.DiskWriteBytes = write
		o.DiskIOCount = ops
	}
	o.Runtimes = detectRuntimes()
	// 温度：Windows 无统一接口，保留 nil（前端显示「—」）
	return o, nil
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return h
}
