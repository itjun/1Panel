//go:build windows

package localapps

import (
	"encoding/binary"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows 进程 / 网络底层采集：
//   - NtQuerySystemInformation(SystemProcessInformation)：全进程 CPU 时间、内存、IO 计数、线程表
//   - NtQueryInformationProcess + ReadProcessMemory：命令行与工作目录（读远端 PEB）
//   - OpenProcessToken + LookupAccountSid：进程属主
//   - GetExtendedTcpTable / GetExtendedUdpTable：按 PID 的监听与连接
// 全部走系统 API，不解析 PowerShell/wmic 文本。

var (
	modNtdll      = windows.NewLazySystemDLL("ntdll.dll")
	procNtQuerySystemInfo   = modNtdll.NewProc("NtQuerySystemInformation")
	procNtQueryProcessInfo  = modNtdll.NewProc("NtQueryInformationProcess")

	modIphlpapi   = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcpTable = modIphlpapi.NewProc("GetExtendedTcpTable")
	procGetExtendedUdpTable = modIphlpapi.NewProc("GetExtendedUdpTable")

	modUser32     = windows.NewLazySystemDLL("user32.dll")
	procPostMessageW = modUser32.NewProc("PostMessageW")
)

const (
	sysInfoProcess        = 5  // SystemProcessInformation
	processBasicInfo      = 0  // ProcessBasicInformation
	tcpTableOwnerPidAll   = 5  // TCP_TABLE_OWNER_PID_ALL
	udpTableOwnerPid      = 1  // UDP_TABLE_OWNER_PID
	wmClose               = 0x0010
	ntStatusInfoLenMismatch = 0xC0000004
)

// ntUnicodeString 对应 UNICODE_STRING（x64）。
type ntUnicodeString struct {
	Length        uint16
	MaximumLength uint16
	_             uint32
	Buffer        uintptr
}

// ntSysThreadInfo 对应 SYSTEM_THREAD_INFORMATION（x64，80 字节）。
type ntSysThreadInfo struct {
	KernelTime       int64
	UserTime         int64
	CreateTime       int64
	WaitTime         uint32
	_                uint32
	StartAddress     uintptr
	ProcessID        uintptr
	ThreadID         uintptr
	Priority         int32
	BasePriority     int32
	ContextSwitches  uint32
	ThreadState      uint32
	WaitReason       uint32
	_                uint32
}

// ntSysProcInfo 对应 SYSTEM_PROCESS_INFORMATION 头部（x64，线程数组前 256 字节）。
type ntSysProcInfo struct {
	NextEntryOffset              uint32
	NumberOfThreads              uint32
	WorkingSetPrivateSize        int64
	HardFaultCount               uint32
	NumberOfThreadsHighWatermark uint32
	CycleTime                    uint64
	CreateTime                   int64
	UserTime                     int64
	KernelTime                   int64
	ImageName                    ntUnicodeString
	BasePriority                 int32
	_                            uint32
	UniqueProcessID              uintptr
	InheritedFromUniqueProcessID uintptr
	HandleCount                  uint32
	SessionID                    uint32
	UniqueProcessKey             uintptr
	PeakVirtualSize              uintptr
	VirtualSize                  uintptr
	PageFaultCount               uint32
	_                            uint32
	PeakWorkingSetSize           uintptr
	WorkingSetSize               uintptr
	QuotaPeakPagedPoolUsage      uintptr
	QuotaPagedPoolUsage          uintptr
	QuotaPeakNonPagedPoolUsage   uintptr
	QuotaNonPagedPoolUsage       uintptr
	PagefileUsage                uintptr
	PeakPagefileUsage            uintptr
	PrivatePageCount             uintptr
	ReadOperationCount           uint64
	WriteOperationCount          uint64
	OtherOperationCount          uint64
	ReadTransferCount            uint64
	WriteTransferCount           uint64
	OtherTransferCount           uint64
	Threads                      [1]ntSysThreadInfo
}

// utf16BytesToString 解码小端 UTF-16 字节串（快照内嵌字符串不走指针转换，规避 vet 告警）。
func utf16BytesToString(b []byte) string {
	units := make([]uint16, len(b)/2)
	for i := range units {
		units[i] = uint16(b[2*i]) | uint16(b[2*i+1])<<8
	}
	return windows.UTF16ToString(units)
}

// winProcEntry 解析后的进程基础信息。
type winProcEntry struct {
	PID          int
	PPID         int
	ImageName    string // 如 "java.exe"；系统 Idle 进程为空
	UserTime     uint64 // 100ns 单位
	KernelTime   uint64
	CreateTime   int64  // FILETIME
	ThreadCount  int
	WorkingSet   uint64 // bytes
	ReadBytes    uint64
	WriteBytes   uint64
	ReadOps      uint64
	WriteOps     uint64
	Threads      []winThreadEntry
}

type winThreadEntry struct {
	TID         uint64
	KernelTime  uint64
	UserTime    uint64
	State       uint32
	WaitReason  uint32
}

// winProcessSnapshot 一次 NtQuerySystemInformation 拿到全部进程。
func winProcessSnapshot() ([]winProcEntry, error) {
	size := uint32(1 << 20)
	for attempt := 0; attempt < 5; attempt++ {
		buf := make([]byte, size)
		var retLen uint32
		r0, _, _ := procNtQuerySystemInfo.Call(
			uintptr(sysInfoProcess),
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(len(buf)),
			uintptr(unsafe.Pointer(&retLen)))
		if r0 == ntStatusInfoLenMismatch {
			size = retLen + 64*1024
			continue
		}
		if r0 != 0 {
			return nil, syscall.Errno(r0)
		}
		return parseProcessSnapshot(buf), nil
	}
	return nil, fmt.Errorf("进程快照长度不匹配")
}

func parseProcessSnapshot(buf []byte) []winProcEntry {
	var out []winProcEntry
	offset := 0
	for {
		if offset+int(unsafe.Sizeof(ntSysProcInfo{})) > len(buf) {
			break
		}
		row := (*ntSysProcInfo)(unsafe.Pointer(&buf[offset]))
		entry := winProcEntry{
			PID:          int(row.UniqueProcessID),
			PPID:         int(row.InheritedFromUniqueProcessID),
			UserTime:     uint64(row.UserTime),
			KernelTime:   uint64(row.KernelTime),
			CreateTime:   row.CreateTime,
			ThreadCount:  int(row.NumberOfThreads),
			WorkingSet:   uint64(row.WorkingSetSize),
			ReadBytes:    row.ReadTransferCount,
			WriteBytes:   row.WriteTransferCount,
			ReadOps:      row.ReadOperationCount,
			WriteOps:     row.WriteOperationCount,
		}
		if row.ImageName.Length > 0 && row.ImageName.Buffer != 0 {
			n := uintptr(row.ImageName.Length)
			bufBase := uintptr(unsafe.Pointer(&buf[0]))
			if off := row.ImageName.Buffer - bufBase; off >= 0 && off+n <= uintptr(len(buf)) && off%2 == 0 {
				entry.ImageName = utf16BytesToString(buf[off : off+n : off+n])
			}
		}
		if n := int(row.NumberOfThreads); n > 0 {
			threadsOff := offset + int(unsafe.Offsetof(ntSysProcInfo{}.Threads))
			threadSize := int(unsafe.Sizeof(ntSysThreadInfo{}))
			for i := 0; i < n; i++ {
				if threadsOff+i*threadSize+threadSize > len(buf) {
					break
				}
				t := (*ntSysThreadInfo)(unsafe.Pointer(&buf[threadsOff+i*threadSize]))
				entry.Threads = append(entry.Threads, winThreadEntry{
					TID:        uint64(t.ThreadID),
					KernelTime: uint64(t.KernelTime),
					UserTime:   uint64(t.UserTime),
					State:      t.ThreadState,
					WaitReason: t.WaitReason,
				})
			}
		}
		out = append(out, entry)
		if row.NextEntryOffset == 0 {
			break
		}
		offset += int(row.NextEntryOffset)
	}
	return out
}

// ---- 命令行 / 工作目录（读远端 PEB） ----

// ntPebBasicInfo 对应 PROCESS_BASIC_INFORMATION（x64：6 个指针，48 字节）。
type ntPebBasicInfo struct {
	Reserved1       [1]uintptr
	PebBaseAddress  uintptr
	Reserved2       [2]uintptr
	UniqueProcessID uintptr
	Reserved3       uintptr
}

// pebOffsets：x64 与 arm64 的 PEB/RTL_USER_PROCESS_PARAMETERS 布局一致。
const (
	pebProcParamsOffset      = 0x20
	paramsCurrentDirOffset   = 0x38
	paramsCommandLineOffset  = 0x70
)

func readProcUnicodeString(h windows.Handle, usAddr uintptr) string {
	if usAddr == 0 {
		return ""
	}
	var us ntUnicodeString
	if err := windows.ReadProcessMemory(h, usAddr, (*byte)(unsafe.Pointer(&us)), unsafe.Sizeof(us), nil); err != nil {
		return ""
	}
	if us.Length == 0 || us.Buffer == 0 || us.Length > 32768 {
		return ""
	}
	raw := make([]uint16, us.Length/2)
	if err := windows.ReadProcessMemory(h, us.Buffer, (*byte)(unsafe.Pointer(&raw[0])), uintptr(us.Length), nil); err != nil {
		return ""
	}
	return windows.UTF16ToString(raw)
}

// readProcCmdlineCwd 读取进程命令行与工作目录；无权限或非本架构时返回空串。
func readProcCmdlineCwd(pid int) (cmdline, cwd string) {
	if pid <= 0 {
		return "", ""
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.PROCESS_VM_READ, false, uint32(pid))
	if err != nil {
		return "", ""
	}
	defer windows.CloseHandle(h)

	var pbi ntPebBasicInfo
	r0, _, _ := procNtQueryProcessInfo.Call(
		uintptr(h),
		uintptr(processBasicInfo),
		uintptr(unsafe.Pointer(&pbi)),
		unsafe.Sizeof(pbi),
		0)
	if r0 != 0 || pbi.PebBaseAddress == 0 {
		return "", ""
	}
	var paramsPtr uintptr
	if err := windows.ReadProcessMemory(h, pbi.PebBaseAddress+pebProcParamsOffset,
		(*byte)(unsafe.Pointer(&paramsPtr)), unsafe.Sizeof(paramsPtr), nil); err != nil {
		return "", ""
	}
	if paramsPtr == 0 {
		return "", ""
	}
	cwd = readProcUnicodeString(h, paramsPtr+paramsCurrentDirOffset)
	cmdline = readProcUnicodeString(h, paramsPtr+paramsCommandLineOffset)
	return cmdline, cwd
}

// splitCommandLine 按 Windows 传给子进程的原样参数切分（GetCommandLine 语义）。
func splitCommandLine(s string) []string {
	var args []string
	var cur strings.Builder
	isQuoted := false
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == '"':
			if isQuoted && i+1 < len(s) && s[i+1] == '"' {
				cur.WriteByte('"')
				i += 2
				continue
			}
			isQuoted = !isQuoted
			i++
		case (c == ' ' || c == '\t') && !isQuoted:
			if cur.Len() > 0 {
				args = append(args, cur.String())
				cur.Reset()
			}
			i++
		default:
			cur.WriteByte(c)
			i++
		}
	}
	if cur.Len() > 0 {
		args = append(args, cur.String())
	}
	return args
}

// ---- 进程属主 ----

var (
	ownerMu    sync.Mutex
	ownerCache = map[string]string{} // SID 字符串 -> DOMAIN\user
)

func currentUserName() string {
	tok, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return ""
	}
	defer tok.Close()
	tu, err := tok.GetTokenUser()
	if err != nil || tu == nil {
		return ""
	}
	return sidToName(tu.User.Sid)
}

func sidToName(sid *windows.SID) string {
	if sid == nil {
		return ""
	}
	key := sid.String()
	if key == "" {
		return ""
	}
	ownerMu.Lock()
	cached, ok := ownerCache[key]
	ownerMu.Unlock()
	if ok {
		return cached
	}
	name, _, t, err := sid.LookupAccount("")
	_ = t
	var full string
	if err == nil {
		full = name
	} else {
		full = key
	}
	ownerMu.Lock()
	ownerCache[key] = full
	ownerMu.Unlock()
	return full
}

// processOwner 返回进程属主（DOMAIN\user 或 SID 文本）；无权限返回空串。
func processOwner(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	var tok windows.Token
	if err := windows.OpenProcessToken(h, windows.TOKEN_QUERY, &tok); err != nil {
		return ""
	}
	defer tok.Close()
	tu, err := tok.GetTokenUser()
	if err != nil || tu == nil {
		return ""
	}
	return sidToName(tu.User.Sid)
}

// processExePath 查询进程主程序完整路径。
func processExePath(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	var buf [1024]uint16
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}

// ---- TCP / UDP 表 ----

type tcpRowOwnerPid struct {
	State      uint32
	LocalAddr  uint32
	LocalPort  uint32
	RemoteAddr uint32
	RemotePort uint32
	OwningPid  uint32
}

type udpRowOwnerPid struct {
	LocalAddr uint32
	LocalPort uint32
	OwningPid uint32
}

// MIB_TCP6ROW_OWNER_PID：State + 本/远端 v6 地址、scopeId、端口、属主。
type tcp6RowOwnerPid struct {
	State         uint32
	LocalAddr     [16]byte
	LocalScopeId  uint32
	LocalPort     uint32
	RemoteAddr    [16]byte
	RemoteScopeId uint32
	RemotePort    uint32
	OwningPid     uint32
}

// MIB_UDP6ROW_OWNER_PID：本端 v6 地址、scopeId、端口、属主。
type udp6RowOwnerPid struct {
	LocalAddr    [16]byte
	LocalScopeId uint32
	LocalPort    uint32
	OwningPid    uint32
}

type winSocketInfo struct {
	Protocol string // TCP / UDP
	State    string // LISTEN / ESTABLISHED / ...
	Local    string
	Remote   string
	PID      int
}

// socketSnapshot 枚举全部 TCP/UDP 端点（v4 + v6，含属主 PID）。
func socketSnapshot() ([]winSocketInfo, error) {
	var out []winSocketInfo
	if rows, err := tcpTableRows(); err == nil {
		for _, r := range rows {
			out = append(out, winSocketInfo{
				Protocol: "TCP",
				State:    tcpStateName(r.State),
				Local:    joinHostPort(inetAddr(r.LocalAddr), r.LocalPort),
				Remote:   joinHostPort(inetAddr(r.RemoteAddr), r.RemotePort),
				PID:      int(r.OwningPid),
			})
		}
	}
	if rows, err := tcp6TableRows(); err == nil {
		for _, r := range rows {
			out = append(out, winSocketInfo{
				Protocol: "TCP",
				State:    tcpStateName(r.State),
				Local:    joinHostPortV6(r.LocalAddr, r.LocalPort),
				Remote:   joinHostPortV6(r.RemoteAddr, r.RemotePort),
				PID:      int(r.OwningPid),
			})
		}
	}
	if rows, err := udpTableRows(); err == nil {
		for _, r := range rows {
			out = append(out, winSocketInfo{
				Protocol: "UDP",
				State:    "",
				Local:    joinHostPort(inetAddr(r.LocalAddr), r.LocalPort),
				Remote:   "",
				PID:      int(r.OwningPid),
			})
		}
	}
	if rows, err := udp6TableRows(); err == nil {
		for _, r := range rows {
			out = append(out, winSocketInfo{
				Protocol: "UDP",
				State:    "",
				Local:    joinHostPortV6(r.LocalAddr, r.LocalPort),
				Remote:   "",
				PID:      int(r.OwningPid),
			})
		}
	}
	return out, nil
}

func tcpTableRows() ([]tcpRowOwnerPid, error) {
	// ulAf 固定 AF_INET（IPv4 端点足够覆盖监听识别；IPv6 表是另一套行结构）
	const afInet = 2
	size := uint32(0)
	procGetExtendedTcpTable.Call(0, uintptr(unsafe.Pointer(&size)), 0, afInet, tcpTableOwnerPidAll, 0)
	if size == 0 {
		return nil, fmt.Errorf("TCP 表为空")
	}
	buf := make([]byte, size)
	r0, _, _ := procGetExtendedTcpTable.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
		0, afInet, tcpTableOwnerPidAll, 0)
	if r0 != 0 {
		return nil, syscall.Errno(r0)
	}
	count := *(*uint32)(unsafe.Pointer(&buf[0]))
	if count == 0 || int(count) > len(buf)/int(unsafe.Sizeof(tcpRowOwnerPid{})) {
		return nil, nil
	}
	rows := (*[1 << 20]tcpRowOwnerPid)(unsafe.Pointer(&buf[4]))
	return rows[:count:count], nil
}

func udpTableRows() ([]udpRowOwnerPid, error) {
	const afInet = 2
	size := uint32(0)
	procGetExtendedUdpTable.Call(0, uintptr(unsafe.Pointer(&size)), 0, afInet, udpTableOwnerPid, 0)
	if size == 0 {
		return nil, fmt.Errorf("UDP 表为空")
	}
	buf := make([]byte, size)
	r0, _, _ := procGetExtendedUdpTable.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
		0, afInet, udpTableOwnerPid, 0, 0)
	if r0 != 0 {
		return nil, syscall.Errno(r0)
	}
	count := *(*uint32)(unsafe.Pointer(&buf[0]))
	if count == 0 || int(count) > len(buf)/int(unsafe.Sizeof(udpRowOwnerPid{})) {
		return nil, nil
	}
	rows := (*[1 << 20]udpRowOwnerPid)(unsafe.Pointer(&buf[4]))
	return rows[:count:count], nil
}

// getExtendedTable 按 family（2=AF_INET, 23=AF_INET6）与表类型调 IP Helper，
// 返回原始缓冲；调用方按各自行结构解析。
func getExtendedTable(proc *windows.LazyProc, family, tableClass uint32) ([]byte, error) {
	size := uint32(0)
	proc.Call(0, uintptr(unsafe.Pointer(&size)), 0, uintptr(family), uintptr(tableClass), 0)
	if size == 0 {
		return nil, fmt.Errorf("表为空")
	}
	buf := make([]byte, size)
	r0, _, _ := proc.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
		0, uintptr(family), uintptr(tableClass), 0)
	if r0 != 0 {
		return nil, syscall.Errno(r0)
	}
	return buf, nil
}

func tcp6TableRows() ([]tcp6RowOwnerPid, error) {
	const afInet6 = 23
	buf, err := getExtendedTable(procGetExtendedTcpTable, afInet6, tcpTableOwnerPidAll)
	if err != nil {
		return nil, err
	}
	count := *(*uint32)(unsafe.Pointer(&buf[0]))
	if count == 0 || int(count) > len(buf)/int(unsafe.Sizeof(tcp6RowOwnerPid{})) {
		return nil, nil
	}
	rows := (*[1 << 20]tcp6RowOwnerPid)(unsafe.Pointer(&buf[4]))
	return rows[:count:count], nil
}

func udp6TableRows() ([]udp6RowOwnerPid, error) {
	const afInet6 = 23
	buf, err := getExtendedTable(procGetExtendedUdpTable, afInet6, udpTableOwnerPid)
	if err != nil {
		return nil, err
	}
	count := *(*uint32)(unsafe.Pointer(&buf[0]))
	if count == 0 || int(count) > len(buf)/int(unsafe.Sizeof(udp6RowOwnerPid{})) {
		return nil, nil
	}
	rows := (*[1 << 20]udp6RowOwnerPid)(unsafe.Pointer(&buf[4]))
	return rows[:count:count], nil
}

func joinHostPortV6(addr [16]byte, portNetworkOrder uint32) string {
	return net.JoinHostPort(net.IP(addr[:]).String(), strconv.Itoa(portFromNetOrder(portNetworkOrder)))
}

func inetAddr(v uint32) string {
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], v)
	return net.IPv4(b[0], b[1], b[2], b[3]).String()
}

// portFromNetOrder 表内端口按网络字节序存于低 16 位，换算为主机序。
func portFromNetOrder(v uint32) int {
	return int((v&0xFF)<<8 | (v>>8)&0xFF)
}

func joinHostPort(host string, portNetworkOrder uint32) string {
	return net.JoinHostPort(host, strconv.Itoa(portFromNetOrder(portNetworkOrder)))
}

// tcpStateName MIB_TCP_STATE 常量到展示名。
func tcpStateName(state uint32) string {
	switch state {
	case 1:
		return "CLOSED"
	case 2:
		return "LISTEN"
	case 3:
		return "SYN_SENT"
	case 4:
		return "SYN_RCVD"
	case 5:
		return "ESTABLISHED"
	case 6:
		return "FIN_WAIT1"
	case 7:
		return "FIN_WAIT2"
	case 8:
		return "CLOSE_WAIT"
	case 9:
		return "CLOSING"
	case 10:
		return "LAST_ACK"
	case 11:
		return "TIME_WAIT"
	case 12:
		return "DELETE_TCB"
	default:
		return fmt.Sprintf("STATE_%d", state)
	}
}

// threadStateName KTHREAD_STATE 到展示名。
func threadStateName(state uint32) string {
	switch state {
	case 0:
		return "Initialized"
	case 1:
		return "Ready"
	case 2:
		return "Running"
	case 3:
		return "Standby"
	case 4:
		return "Terminated"
	case 5:
		return "Waiting"
	case 6:
		return "Transition"
	case 7:
		return "DeferredReady"
	case 8:
		return "GateWait"
	default:
		return fmt.Sprintf("State%d", state)
	}
}

// filetimeToUnix FILETIME（1601 纪元，100ns）转 Unix 秒。
func filetimeToUnix(ft int64) int64 {
	if ft <= 0 {
		return 0
	}
	const epochDelta = 116444736000000000
	return (ft - epochDelta) / 1e7
}

