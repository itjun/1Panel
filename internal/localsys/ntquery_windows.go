//go:build windows

package localsys

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ntdll 直调封装：系统级磁盘 IO 计数。
// Windows 没有等价的 Go 标准库接口，也不适合靠 PowerShell 文本采集。
var (
	modNtdll              = windows.NewLazySystemDLL("ntdll.dll")
	procNtQuerySystemInfo = modNtdll.NewProc("NtQuerySystemInformation")
)

const (
	sysInfoClassPerformance = 2 // SystemPerformanceInformation（系统级 IO 计数）
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

// ntSystemPerfHead 只取 SystemPerformanceInformation 头部的 IO 累计字段。
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
