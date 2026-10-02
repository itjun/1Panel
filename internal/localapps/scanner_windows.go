//go:build windows

package localapps

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	cpuPrevAt time.Time
	threadCPU = map[uint64]uint64{} // tid -> 上一轮 (user+kernel) 100ns
)

// procCPUSample 单轮扫描内的进程 CPU 时间，供下一轮差分。
type procCPUSample struct {
	cpu100ns uint64
	at       time.Time
}

var procCPUPrev = map[int]procCPUSample{}

// collectProcs Windows：NT 进程快照 + 属主过滤（管理员可跨用户）。
func collectProcs(now time.Time) ([]RawProc, []string, error) {
	warnings := []string{
		"Windows 下暂无法按进程统计网络收发速率，网络列为 0",
	}
	procs, err := winProcessSnapshot()
	if err != nil {
		return nil, warnings, fmt.Errorf("读取进程快照失败: %w", err)
	}

	currentUser := currentUserName()
	raws := make([]RawProc, 0, 32)
	for i := range procs {
		p := &procs[i]
		if p.PID <= 0 || p.PID == 4 { // Idle / System
			continue
		}
		owner := processOwner(p.PID)
		if owner == "" || (currentUser != "" && owner != currentUser && !isAdminToken()) {
			continue
		}
		exe := processExePath(p.PID)
		comm := p.ImageName
		if comm == "" && exe != "" {
			comm = exeBase(exe)
		}
		cmdline, cwd := readProcCmdlineCwd(p.PID)
		args := splitCommandLine(cmdline)
		if args == nil {
			args = []string{}
		}

		rp := RawProc{
			PID:         p.PID,
			PPID:        p.PPID,
			User:        owner,
			CPU:         procCPUPercent(p, now),
			RSS:         p.WorkingSet,
			ThreadCount: maxInt(p.ThreadCount, 1),
			Elapsed:     uptimeSeconds(p.CreateTime),
			Comm:        comm,
			Exe:         exe,
			Cwd:         cwd,
			Cmd:         cmdline,
			Args:        args,
			DiskRead:    p.ReadBytes,
			DiskWrite:   p.WriteBytes,
			Extra:       map[string]string{},
			Threads:     threadNodes(p, now),
		}
		raws = append(raws, rp)
	}
	return raws, warnings, nil
}

// collectListeners Windows：NT 套接字表（含属主 PID）。
func collectListeners(pids []int) (map[int][]string, []string) {
	sockets, _ := socketSnapshot()
	return listenersByPID(sockets), nil
}

// fillProcCwds Windows：collectProcs 已随命令行一并读取，无需批量补。
func fillProcCwds(kept []*RawProc) {}

// collectProcDetail Windows：单进程基础字段 + 套接字表强刷监听地址。
func collectProcDetail(pid int, now time.Time) (*RawProc, error) {
	procs, err := winProcessSnapshot()
	if err != nil {
		return nil, fmt.Errorf("读取进程快照失败: %w", err)
	}
	var base *winProcEntry
	for i := range procs {
		if procs[i].PID == pid {
			base = &procs[i]
			break
		}
	}
	if base == nil {
		return nil, fmt.Errorf("进程不存在: %d", pid)
	}

	sockets, _ := socketSnapshot()
	var listenAddrs []string
	var ports []int
	for _, sk := range sockets {
		if sk.PID != pid || sk.Protocol != "TCP" || sk.State != "LISTEN" {
			continue
		}
		listenAddrs = append(listenAddrs, "TCP "+sk.Local+" (LISTEN)")
		if pt := parseListenPort(sk.Local); pt > 0 {
			ports = append(ports, pt)
		}
	}

	owner := processOwner(pid)
	exe := processExePath(pid)
	comm := base.ImageName
	if comm == "" && exe != "" {
		comm = exeBase(exe)
	}
	cmdline, cwd := readProcCmdlineCwd(pid)
	args := splitCommandLine(cmdline)
	if args == nil {
		args = []string{}
	}

	rp := &RawProc{
		PID:         base.PID,
		PPID:        base.PPID,
		User:        owner,
		CPU:         procCPUPercent(base, now),
		RSS:         base.WorkingSet,
		ThreadCount: maxInt(base.ThreadCount, 1),
		Elapsed:     uptimeSeconds(base.CreateTime),
		Comm:        comm,
		Exe:         exe,
		Cwd:         cwd,
		Cmd:         cmdline,
		Args:        args,
		DiskRead:    base.ReadBytes,
		DiskWrite:   base.WriteBytes,
		Extra:       map[string]string{},
		Threads:     threadNodes(base, now),
	}
	rp.ListenAddresses = listenAddrs
	rp.Ports = uniqueSortedPorts(ports)
	return rp, nil
}

// listProcResources Windows 列出进程的网络端点。Windows 无普通用户可用的文件句柄枚举接口，
// 仅返回 TCP/UDP 连接并给出说明。
func listProcResources(pid int) (*ResourceSnapshot, error) {
	sockets, err := socketSnapshot()
	if err != nil {
		return nil, err
	}
	snap := &ResourceSnapshot{
		PID: pid,
		Warnings: []string{
			"Windows 下仅能列出网络端点；打开的文件句柄无免管理员的枚举接口",
		},
	}
	for _, sk := range sockets {
		if sk.PID != pid {
			continue
		}
		snap.Resources = append(snap.Resources, ProcResource{
			Type:          "socket",
			Name:          sk.Local,
			Protocol:      sk.Protocol,
			State:         sk.State,
			LocalAddress:  sk.Local,
			RemoteAddress: sk.Remote,
		})
	}
	return snap, nil
}

// killProc Windows：force=false 时先向窗口投递 WM_CLOSE 优雅关闭，
// 无窗口或未退出时报错提示改用强制结束；force=true 直接 TerminateProcess。
func killProc(pid int, force bool) error {
	currentUser := currentUserName()
	owner := processOwner(pid)
	if owner == "" {
		// 找不到属主多半是权限不足的系统进程
		return fmt.Errorf("无法读取进程 %d 的属主（可能需要管理员权限）", pid)
	}
	if currentUser != "" && owner != currentUser && !isAdminToken() {
		return fmt.Errorf("只能结束当前用户(%s)的进程，目标属主为 %s", currentUser, owner)
	}
	if force {
		return terminateProcess(pid)
	}
	if posted := postCloseToWindows(pid); posted {
		// 给窗口化的进程一点自行退出的时间
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			if !processAlive(pid) {
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
		return fmt.Errorf("已发送关闭消息但进程未退出（控制台/服务进程需要强制结束）")
	}
	return fmt.Errorf("该进程没有可关闭的窗口，请使用强制结束")
}

// cleanupScanHistory Windows：清理进程 / 线程差分缓存。
func cleanupScanHistory(alive map[int]bool, now time.Time) {
	for pid := range procCPUPrev {
		if !alive[pid] {
			delete(procCPUPrev, pid)
		}
	}
	if now.Sub(cpuPrevAt) > 10*time.Minute {
		threadCPU = map[uint64]uint64{}
	}
}

func terminateProcess(pid int) error {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return fmt.Errorf("打开进程失败: %w", err)
	}
	defer windows.CloseHandle(h)
	if err := windows.TerminateProcess(h, 1); err != nil {
		return fmt.Errorf("结束进程失败: %w", err)
	}
	return nil
}

// postCloseToWindows 向属于 pid 的顶层窗口投递 WM_CLOSE；返回是否投递成功。
func postCloseToWindows(pid int) bool {
	posted := false
	cb := windows.NewCallback(func(hwnd windows.HWND, lparam uintptr) uintptr {
		var winPid uint32
		if _, err := windows.GetWindowThreadProcessId(hwnd, &winPid); err == nil && int(winPid) == pid {
			r0, _, _ := procPostMessageW.Call(uintptr(hwnd), wmClose, 0, 0)
			if r0 != 0 {
				posted = true
			}
		}
		return 1 // 继续枚举
	})
	_ = windows.EnumWindows(cb, nil)
	return posted
}

func processAlive(pid int) bool {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	var code uint32
	if err := windows.GetExitCodeProcess(h, &code); err != nil {
		return true
	}
	return code == 259 // STILL_ACTIVE
}

// isAdminToken 当前进程是否以管理员令牌运行。
func isAdminToken() bool {
	var admin *windows.SID
	if err := windows.AllocateAndInitializeSid(
		&windows.SidIdentifierAuthority{Value: [6]byte{0, 0, 0, 0, 0, 5}}, // NT AUTHORITY
		2, 32, 544, 0, 0, 0, 0, 0, 0, &admin); err != nil {
		return false
	}
	tok, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return false
	}
	defer tok.Close()
	member, err := tok.IsMember(admin)
	if err != nil {
		return false
	}
	if !member {
		return false
	}
	// Administrators 组成员还要看令牌是否已提升
	var tokenElevation uint32
	var returned uint32
	_ = windows.GetTokenInformation(tok, windows.TokenElevation,
		(*byte)(unsafe.Pointer(&tokenElevation)), uint32(unsafe.Sizeof(tokenElevation)), &returned)
	return tokenElevation != 0
}

// ---- 差分与工具 ----

// procCPUPercent 与 macOS ps pcpu 同口径：CPU 时间增量 / 实际经过时间（可超 100%）。
func procCPUPercent(p *winProcEntry, now time.Time) float64 {
	cur := p.UserTime + p.KernelTime
	prev, ok := procCPUPrev[p.PID]
	procCPUPrev[p.PID] = procCPUSample{cpu100ns: cur, at: now}
	if !ok || prev.at.IsZero() {
		return 0
	}
	dt := now.Sub(prev.at).Seconds()
	if dt <= 0 {
		return 0
	}
	if cur < prev.cpu100ns {
		return 0
	}
	deltaSec := float64(cur-prev.cpu100ns) / 1e7
	return deltaSec / dt * 100
}

func threadNodes(p *winProcEntry, now time.Time) []ThreadNode {
	if len(p.Threads) == 0 {
		return []ThreadNode{}
	}
	out := make([]ThreadNode, 0, len(p.Threads))
	for _, t := range p.Threads {
		if t.TID == 0 {
			continue
		}
		cur := t.KernelTime + t.UserTime
		prev, ok := threadCPU[t.TID]
		threadCPU[t.TID] = cur
		cpu := 0.0
		if ok && !cpuPrevAt.IsZero() {
			dt := now.Sub(cpuPrevAt).Seconds()
			if dt > 0 && cur >= prev {
				cpu = (float64(cur-prev) / 1e7) / dt * 100
			}
		}
		out = append(out, ThreadNode{
			TID:   t.TID,
			Name:  "",
			CPU:   cpu,
			State: threadStateName(t.State),
		})
	}
	cpuPrevAt = now
	sort.Slice(out, func(i, j int) bool { return out[i].CPU > out[j].CPU })
	if len(out) > 64 {
		out = out[:64]
	}
	return out
}

func uptimeSeconds(createTime int64) uint64 {
	unix := filetimeToUnix(createTime)
	if unix <= 0 {
		return 0
	}
	up := time.Now().Unix() - unix
	if up < 0 {
		return 0
	}
	return uint64(up)
}

func listenersByPID(sockets []winSocketInfo) map[int][]string {
	byPID := map[int][]string{}
	seen := map[int]map[string]bool{}
	for _, sk := range sockets {
		if sk.Protocol != "TCP" || sk.State != "LISTEN" || sk.PID <= 0 {
			continue
		}
		addr := "TCP " + sk.Local + " (LISTEN)"
		if seen[sk.PID] == nil {
			seen[sk.PID] = map[string]bool{}
		}
		if !seen[sk.PID][addr] {
			seen[sk.PID][addr] = true
			byPID[sk.PID] = append(byPID[sk.PID], addr)
		}
	}
	for pid := range byPID {
		sort.Strings(byPID[pid])
	}
	return byPID
}

func exeBase(path string) string {
	path = strings.TrimRight(path, `\`)
	if i := strings.LastIndexByte(path, '\\'); i >= 0 {
		return path[i+1:]
	}
	return path
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
