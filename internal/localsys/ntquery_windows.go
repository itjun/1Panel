//go:build windows

package localsys

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ntdll 直调封装：CPU tick、系统级磁盘 IO、页面文件用量。
// 这些信息 Windows 没有等价的 Go 标准库接口，也不适合靠 PowerShell 文本采集。
var (
	modNtdll     = windows.NewLazySystemDLL("ntdll.dll")
	procNtQuerySystemInfo = modNtdll.NewProc("NtQuerySystemInformation")
)

const (
	sysInfoClassProcessorPerf = 8  // SystemProcessorPerformanceInformation（每逻辑核）
	sysInfoClassPerformance   = 2  // SystemPerformanceInformation（系统级 IO 计数）
	sysInfoClassPageFile      = 18 // SystemPageFileInformation（页面文件用量）
)

// ntQuerySystemInfo 调 NtQuerySystemInformation 填满 buf；返回实际需要的长度。
func ntQuerySystemInfo(class uint32, buf []byte) (retLen uint32, err error) {
	if len(buf) == 0 {
		return 0, fmt.Errorf("ntquery: 空缓冲")
	}
	r0, _, _ := procNtQuerySystemInfo.Call(
		uintptr(class),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(&retLen)))
	if r0 != 0 {
		return retLen, syscall.Errno(r0)
	}
	return retLen, nil
}

// ntSysProcPerf 单逻辑核的 CPU 时间（FILETIME 单位：100ns）。
// KernelTime 包含 Idle 与 DPC；布局按 x64 的 48 字节结构体。
type ntSysProcPerf struct {
	IdleTime      uint64
	KernelTime    uint64
	UserTime      uint64
	DpcTime       uint64
	InterruptTime uint64
	InterruptCount uint32
	_              uint32
}

const sizeofNtSysProcPerf = 48

// ntReadPerCPUTicks 返回每个逻辑核的 (idle, kernel, user) 累计时间。
func ntReadPerCPUTicks() (idle, kernel, user []uint64, err error) {
	n := numLogicalCPUs()
	for attempt := 0; attempt < 3; attempt++ {
		buf := make([]byte, sizeofNtSysProcPerf*n)
		retLen, err := ntQuerySystemInfo(sysInfoClassProcessorPerf, buf)
		if err != nil {
			if err == syscall.Errno(0xC0000004) { // STATUS_INFO_LENGTH_MISMATCH
				n = int(retLen)/sizeofNtSysProcPerf + 1
				if n > 4096 {
					return nil, nil, nil, fmt.Errorf("ntquery: 核数异常 %d", n)
				}
				continue
			}
			return nil, nil, nil, err
		}
		count := int(retLen) / sizeofNtSysProcPerf
		if count == 0 || count > len(buf)/sizeofNtSysProcPerf {
			count = len(buf) / sizeofNtSysProcPerf
		}
		idle = make([]uint64, count)
		kernel = make([]uint64, count)
		user = make([]uint64, count)
		for i := 0; i < count; i++ {
			row := (*ntSysProcPerf)(unsafe.Pointer(&buf[i*sizeofNtSysProcPerf]))
			idle[i] = row.IdleTime
			kernel[i] = row.KernelTime
			user[i] = row.UserTime
		}
		return idle, kernel, user, nil
	}
	return nil, nil, nil, fmt.Errorf("ntquery: 处理器信息长度不匹配")
}

func numLogicalCPUs() int {
	n := runtime.NumCPU()
	if n <= 0 {
		n = 1
	}
	return n
}

// ntSystemPerfInfo 只取 SystemPerformanceInformation 头部的 IO 累计字段。
type ntSystemPerfHead struct {
	IdleProcessTime       uint64 // offset 0
	IoReadTransferCount   uint64 // 8
	IoWriteTransferCount  uint64 // 16
	IoOtherTransferCount  uint64 // 24
	IoReadOperationCount  uint32 // 32
	IoWriteOperationCount uint32 // 36
	IoOtherOperationCount uint32 // 40
	AvailablePages        uint32 // 44
}

// ntSystemDiskIO 返回系统累计磁盘读写字节与读写次数。
// 布局来源：SystemPerformanceInformation 头部（Vista 起稳定，phnt/winternl 已文档化）；
// 该结构体未官方导出，偏移随系统演进存在漂移风险，读出异常值时整组作废。
func ntSystemDiskIO() (readBytes, writeBytes, ops uint64, ok bool) {
	buf := make([]byte, 512)
	if _, err := ntQuerySystemInfo(sysInfoClassPerformance, buf); err != nil {
		return 0, 0, 0, false
	}
	head := (*ntSystemPerfHead)(unsafe.Pointer(&buf[0]))
	const absurd = uint64(1) << 62
	if head.IoReadTransferCount >= absurd || head.IoWriteTransferCount >= absurd {
		return 0, 0, 0, false
	}
	return head.IoReadTransferCount, head.IoWriteTransferCount,
		uint64(head.IoReadOperationCount) + uint64(head.IoWriteOperationCount), true
}

// ntPageFileUsage 汇总所有页面文件的当前用量（字节）。
// TotalSize/TotalUsed 单位是页（x64 上通常 4KB，按系统页大小换算）。
func ntPageFileUsage() (total, used uint64, ok bool) {
	buf := make([]byte, 4096)
	if _, err := ntQuerySystemInfo(sysInfoClassPageFile, buf); err != nil {
		return 0, 0, false
	}
	pageSize := uint64(windows.Getpagesize())
	offset := 0
	for {
		if offset+16 > len(buf) {
			break
		}
		next := *(*uint32)(unsafe.Pointer(&buf[offset]))
		totalSize := *(*uint32)(unsafe.Pointer(&buf[offset+4]))
		totalUsed := *(*uint32)(unsafe.Pointer(&buf[offset+8]))
		total += uint64(totalSize) * pageSize
		used += uint64(totalUsed) * pageSize
		if next == 0 {
			break
		}
		offset += int(next)
	}
	return total, used, total > 0
}
