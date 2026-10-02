//go:build linux

package localapps

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/process"

	"diteng-pannel/internal/prochide"
)

// Linux 扫描器：gopsutil（/proc）读进程基础字段，监听与 fd 明细手解 /proc/net/* 与 /proc/<pid>/fd。
// 进程级网络收发速率 Linux 内核无常规计数（需 eBPF），置 0 并提示。

const (
	linuxClockTicks = 100 // USER_HZ，主流发行版恒为 100
	linuxMaxThreads = 64
)

var (
	linuxCPUMu   sync.Mutex
	linuxCPUPrev = map[int]linuxCPUSample{}

	linuxThreadMu     sync.Mutex
	linuxThreadCPU    = map[uint64]uint64{} // (pid<<32)|tid -> 上一轮 utime+stime ticks
	linuxThreadPrevAt time.Time

	uidNameMu    sync.Mutex
	uidNameCache = map[uint32]string{}

	netBytesMu sync.Mutex
	netBytes   = map[int]netPair{} // pid -> TCP 累计收发字节（ss 采样）
)

// netPair 进程级累计网络字节。
type netPair struct{ in, out uint64 }

var ssPidRe = regexp.MustCompile(`pid=(\d+)`)
var ssBytesAckedRe = regexp.MustCompile(`bytes_acked:(\d+)`)
var ssBytesRecvRe = regexp.MustCompile(`bytes_received:(\d+)`)

// sampleProcNetBytes 用 `ss -tipn` 的 TCP info 聚合进程级累计收发字节。
// 内核只在 TCP 连接上维护字节计数（bytes_acked / bytes_received），UDP / ICMP 不计；
// users:(…pid=…) 仅对当前用户进程可见，与扫描范围一致。返回 ss 是否可用。
func sampleProcNetBytes() bool {
	if _, err := exec.LookPath("ss"); err != nil {
		return false
	}
	cmd := exec.Command("ss", "-tipn", "state", "established")
	prochide.Hide(cmd)
	out, err := cmd.Output()
	if err != nil && len(out) == 0 {
		return false
	}
	agg := ParseSSProcNetBytes(string(out))
	netBytesMu.Lock()
	netBytes = agg
	netBytesMu.Unlock()
	return true
}

// ParseSSProcNetBytes 解析 `ss -tipn state established` 输出（供单测）：
// 套接字行含 users:(("proc",pid=N,fd=M))；缩进续行 info 含 bytes_acked / bytes_received。
// fork 共享的套接字会列出多个 pid，双方各计一次（少见，近似可接受）。
func ParseSSProcNetBytes(raw string) map[int]netPair {
	out := map[int]netPair{}
	pids := []int{}
	for _, line := range strings.Split(raw, "\n") {
		if line == "" {
			continue
		}
		if line[0] == ' ' || line[0] == '\t' {
			// info 续行：归属到当前套接字的所有 pid
			if len(pids) == 0 {
				continue
			}
			in := parseSSBytesField(line, ssBytesRecvRe)
			outv := parseSSBytesField(line, ssBytesAckedRe)
			if in == 0 && outv == 0 {
				continue
			}
			for _, pid := range pids {
				e := out[pid]
				e.in += in
				e.out += outv
				out[pid] = e
			}
			continue
		}
		// 套接字行：重置属主 pid
		pids = pids[:0]
		for _, m := range ssPidRe.FindAllStringSubmatch(line, -1) {
			if pid, err := strconv.Atoi(m[1]); err == nil && pid > 0 {
				pids = append(pids, pid)
			}
		}
	}
	return out
}

func parseSSBytesField(line string, re *regexp.Regexp) uint64 {
	m := re.FindStringSubmatch(line)
	if len(m) != 2 {
		return 0
	}
	v, err := strconv.ParseUint(m[1], 10, 64)
	if err != nil {
		return 0
	}
	return v
}

func procNetBytes(pid int) netPair {
	netBytesMu.Lock()
	defer netBytesMu.Unlock()
	return netBytes[pid]
}

type linuxCPUSample struct {
	cpuSec float64
	at     time.Time
}

// collectProcs Linux：/proc 全量进程，只保留当前用户的；CPU 按两次扫描差分。
func collectProcs(now time.Time) ([]RawProc, []string, error) {
	var warnings []string
	if !sampleProcNetBytes() {
		warnings = append(warnings, "未找到 ss 命令，无法统计进程网络收发速率（iproute2）")
	}
	pids, err := process.Pids()
	if err != nil {
		return nil, warnings, fmt.Errorf("读取进程列表失败: %w", err)
	}
	currentUID := uint32(os.Getuid())
	raws := make([]RawProc, 0, 32)
	for _, pid := range pids {
		p, err := process.NewProcess(pid)
		if err != nil {
			continue
		}
		uids, err := p.Uids()
		if err != nil || len(uids) == 0 || uids[0] != currentUID {
			continue
		}
		comm, _ := p.Name()
		exe, _ := p.Exe()
		args, _ := p.CmdlineSlice()
		if args == nil {
			args = []string{}
		}
		cwd, _ := p.Cwd()

		rp := RawProc{
			PID:     int(pid),
			User:    lookupUIDName(uids[0]),
			Comm:    comm,
			Exe:     exe,
			Cwd:     cwd,
			Cmd:     strings.Join(args, " "),
			Args:    args,
			Extra:   map[string]string{},
			CPU:     linuxProcCPUPercent(p, int(pid), now),
			Threads: linuxThreads(int(pid), now),
		}
		rp.ThreadCount = len(rp.Threads)
		if rp.ThreadCount == 0 {
			if n, err := p.NumThreads(); err == nil && n > 0 {
				rp.ThreadCount = int(n)
			} else {
				rp.ThreadCount = 1
			}
		}
		if mi, err := p.MemoryInfo(); err == nil && mi != nil {
			rp.RSS = mi.RSS
		}
		if ct, err := p.CreateTime(); err == nil && ct > 0 {
			if up := time.Now().Unix() - ct/1000; up > 0 {
				rp.Elapsed = uint64(up)
			}
		}
		if io, err := p.IOCounters(); err == nil && io != nil {
			rp.DiskRead = io.ReadBytes
			rp.DiskWrite = io.WriteBytes
		}
		if nb := procNetBytes(rp.PID); nb.in > 0 || nb.out > 0 {
			rp.NetIn = nb.in
			rp.NetOut = nb.out
		}
		raws = append(raws, rp)
	}
	return raws, warnings, nil
}

// linuxProcCPUPercent CPU 时间增量 / 实际经过时间（可超 100%，与 ps / Windows 口径一致）。
func linuxProcCPUPercent(p *process.Process, pid int, now time.Time) float64 {
	t, err := p.Times()
	if err != nil || t == nil {
		return 0
	}
	cur := t.User + t.System
	linuxCPUMu.Lock()
	defer linuxCPUMu.Unlock()
	prev, ok := linuxCPUPrev[pid]
	linuxCPUPrev[pid] = linuxCPUSample{cpuSec: cur, at: now}
	if !ok {
		return 0
	}
	dt := now.Sub(prev.at).Seconds()
	if dt <= 0 || cur < prev.cpuSec {
		return 0
	}
	return (cur - prev.cpuSec) / dt * 100
}

// linuxThreads 读 /proc/<pid>/task/*：线程名 / 状态 / CPU 差分。
func linuxThreads(pid int, now time.Time) []ThreadNode {
	taskDir := filepath.Join("/proc", strconv.Itoa(pid), "task")
	entries, err := os.ReadDir(taskDir)
	if err != nil {
		return nil
	}
	linuxThreadMu.Lock()
	defer linuxThreadMu.Unlock()
	out := make([]ThreadNode, 0, len(entries))
	for _, e := range entries {
		tid, err := strconv.ParseUint(e.Name(), 10, 64)
		if err != nil {
			continue
		}
		comm, _ := os.ReadFile(filepath.Join(taskDir, e.Name(), "comm"))
		statBytes, err := os.ReadFile(filepath.Join(taskDir, e.Name(), "stat"))
		if err != nil {
			continue
		}
		state, ticks := parseTaskStat(string(statBytes))
		key := uint64(pid)<<32 | tid
		cpu := 0.0
		prev, ok := linuxThreadCPU[key]
		linuxThreadCPU[key] = ticks
		if ok && !linuxThreadPrevAt.IsZero() {
			dt := now.Sub(linuxThreadPrevAt).Seconds()
			if dt > 0 && ticks >= prev {
				cpu = (float64(ticks-prev) / linuxClockTicks) / dt * 100
			}
		}
		out = append(out, ThreadNode{
			TID:   tid,
			Name:  strings.TrimSpace(string(comm)),
			CPU:   cpu,
			State: state,
		})
	}
	linuxThreadPrevAt = now
	sort.Slice(out, func(i, j int) bool { return out[i].CPU > out[j].CPU })
	if len(out) > linuxMaxThreads {
		out = out[:linuxMaxThreads]
	}
	return out
}

// parseTaskStat 取线程状态与 utime+stime（ticks）；stat 的 comm 字段可含空格，按括号定位。
func parseTaskStat(raw string) (state string, ticks uint64) {
	open := strings.LastIndexByte(raw, ')')
	if open < 0 || open+2 > len(raw) {
		return "", 0
	}
	rest := strings.Fields(raw[open+2:])
	if len(rest) < 12 {
		return "", 0
	}
	state = rest[0]
	utime, _ := strconv.ParseUint(rest[11], 10, 64)
	stime, _ := strconv.ParseUint(rest[12], 10, 64)
	return state, utime + stime
}

// lookupUIDName uid → 用户名（缓存；无名回退数字字符串）。
func lookupUIDName(uid uint32) string {
	uidNameMu.Lock()
	defer uidNameMu.Unlock()
	if name, ok := uidNameCache[uid]; ok {
		return name
	}
	name := strconv.FormatUint(uint64(uid), 10)
	if u, err := user.LookupId(name); err == nil && u.Username != "" {
		name = u.Username
	}
	uidNameCache[uid] = name
	return name
}

// ---- 监听表：/proc/net/tcp{,6} LISTEN inode ↔ /proc/<pid>/fd ----

type linuxSocketInfo struct {
	inode    string
	local    string // 已格式化 "ip:port"
	protocol string // TCP / TCP6
}

// collectListeners Linux：先读全表 LISTEN 项，再只对候选进程扫 fd 建 inode→pid 映射。
func collectListeners(pids []int) (map[int][]string, []string) {
	warnings := []string{}
	listenInodes, err := readListeningSockets()
	if err != nil {
		warnings = append(warnings, "读取监听套接字失败: "+err.Error())
		return map[int][]string{}, warnings
	}
	inodeToPid := map[string]int{}
	for _, pid := range pids {
		fdDir := filepath.Join("/proc", strconv.Itoa(pid), "fd")
		entries, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			target, err := os.Readlink(filepath.Join(fdDir, e.Name()))
			if err != nil {
				continue
			}
			if inode, ok := strings.CutPrefix(target, "socket:["); ok {
				inode = strings.TrimSuffix(inode, "]")
				if _, listening := listenInodes[inode]; listening {
					inodeToPid[inode] = pid
				}
			}
		}
	}
	byPID := map[int][]string{}
	seen := map[int]map[string]bool{}
	for inode, pid := range inodeToPid {
		sk := listenInodes[inode]
		addr := "TCP " + sk.local + " (LISTEN)"
		if seen[pid] == nil {
			seen[pid] = map[string]bool{}
		}
		if !seen[pid][addr] {
			seen[pid][addr] = true
			byPID[pid] = append(byPID[pid], addr)
		}
	}
	for pid := range byPID {
		sort.Strings(byPID[pid])
	}
	return byPID, warnings
}

// readListeningSockets 读 /proc/net/tcp 与 /proc/net/tcp6 的 LISTEN 项（inode → 本地地址）。
func readListeningSockets() (map[string]linuxSocketInfo, error) {
	out := map[string]linuxSocketInfo{}
	for _, table := range []struct{ path, protocol string }{
		{"/proc/net/tcp", "TCP"},
		{"/proc/net/tcp6", "TCP6"},
	} {
		b, err := os.ReadFile(table.path)
		if err != nil {
			continue
		}
		for inode, sk := range ParseProcNetTCP(string(b), table.protocol) {
			out[inode] = sk
		}
	}
	return out, nil
}

// ParseProcNetTCP 解析 /proc/net/tcp(6)（供单测）：
// sl local_address rem_address st tx_rx tr:tm->when retrnsmt uid timeout inode ...
// st=0A 即 LISTEN；地址列 32 位小端十六进制，端口大端十六进制。
func ParseProcNetTCP(raw, protocol string) map[string]linuxSocketInfo {
	out := map[string]linuxSocketInfo{}
	for i, line := range strings.Split(raw, "\n") {
		if i == 0 {
			continue // 表头
		}
		fields := strings.Fields(line)
		if len(fields) < 10 || fields[3] != "0A" {
			continue
		}
		local, ok := parseHexSockaddr(fields[1])
		if !ok {
			continue
		}
		out[fields[9]] = linuxSocketInfo{inode: fields[9], local: local, protocol: protocol}
	}
	return out
}

// parseHexSockaddr "0100007F:1F90" → "127.0.0.1:8080"；
// IPv6 每组 32 位按小端拼出 128 位地址。
func parseHexSockaddr(s string) (string, bool) {
	host, port, ok := strings.Cut(s, ":")
	if !ok {
		return "", false
	}
	var ip string
	switch len(host) {
	case 8:
		ip = hexLEIPv4(host)
	case 32:
		ip = hexLEIPv6(host)
	default:
		return "", false
	}
	p, err := strconv.ParseUint(port, 16, 16)
	if err != nil {
		return "", false
	}
	return fmt.Sprintf("%s:%d", ip, p), true
}

func hexLEIPv4(s string) string {
	b := [4]byte{}
	for i := 0; i < 4; i++ {
		v, err := strconv.ParseUint(s[6-2*i:8-2*i], 16, 8)
		if err != nil {
			return "0.0.0.0"
		}
		b[i] = byte(v)
	}
	return fmt.Sprintf("%d.%d.%d.%d", b[0], b[1], b[2], b[3])
}

func hexLEIPv6(s string) string {
	// /proc/net/tcp6 的地址是 4 个 64 位字组、每 32 位小端；按字节还原后交给标准库格式化
	b := make([]byte, 16)
	for w := 0; w < 4; w++ {
		word := s[w*8 : (w+1)*8]
		for i := 0; i < 4; i++ {
			v, _ := strconv.ParseUint(word[6-2*i:8-2*i], 16, 8)
			b[w*4+i] = byte(v)
		}
	}
	return net.IP(b).String()
}

// ---- fd 明细 ----

// listProcResources Linux：遍历 /proc/<pid>/fd，readlink 分类，socket 回查 /proc/net/* 全表。
func listProcResources(pid int) (*ResourceSnapshot, error) {
	snap := &ResourceSnapshot{PID: pid}
	socketTables := loadSocketTables()

	fdDir := filepath.Join("/proc", strconv.Itoa(pid), "fd")
	entries, err := os.ReadDir(fdDir)
	if err != nil {
		return nil, fmt.Errorf("读取进程 %d 的 fd 失败（可能已退出）: %w", pid, err)
	}
	for _, e := range entries {
		fd := e.Name()
		target, err := os.Readlink(filepath.Join(fdDir, fd))
		if err != nil {
			continue
		}
		access := fdAccess(filepath.Join(filepath.Dir(fdDir), "fdinfo", fd))
		if inode, ok := strings.CutPrefix(target, "socket:["); ok {
			inode = strings.TrimSuffix(inode, "]")
			if conn, ok := socketTables[inode]; ok {
				name := conn.local
				if conn.remote != "" {
					name = conn.local + "->" + conn.remote
				}
				snap.Resources = append(snap.Resources, ProcResource{
					FD:            fd,
					Type:          "socket",
					Name:          name,
					Access:        access,
					Protocol:      conn.protocol,
					State:         conn.state,
					LocalAddress:  conn.local,
					RemoteAddress: conn.remote,
				})
				continue
			}
			snap.Resources = append(snap.Resources, ProcResource{
				FD:     fd,
				Type:   "socket",
				Name:   target,
				Access: access,
			})
			continue
		}
		if strings.HasPrefix(target, "pipe:[") || strings.HasPrefix(target, "anon_inode:") {
			snap.Resources = append(snap.Resources, ProcResource{
				FD:     fd,
				Type:   "pipe",
				Name:   target,
				Access: access,
			})
			continue
		}
		resType := "file"
		if st, err := os.Stat(target); err == nil && st.IsDir() {
			resType = "dir"
		}
		snap.Resources = append(snap.Resources, ProcResource{
			FD:     fd,
			Type:   resType,
			Name:   target,
			Access: access,
		})
	}
	sort.Slice(snap.Resources, func(i, j int) bool {
		a, _ := strconv.Atoi(snap.Resources[i].FD)
		b, _ := strconv.Atoi(snap.Resources[j].FD)
		return a < b
	})
	return snap, nil
}

type linuxConnInfo struct {
	protocol string
	state    string
	local    string
	remote   string
}

// loadSocketTables 读 tcp/tcp6/udp/udp6 四张表（inode → 连接信息）。
func loadSocketTables() map[string]linuxConnInfo {
	out := map[string]linuxConnInfo{}
	stateNames := map[string]string{
		"01": "ESTABLISHED", "02": "SYN_SENT", "03": "SYN_RECV", "04": "FIN_WAIT1",
		"05": "FIN_WAIT2", "06": "TIME_WAIT", "07": "CLOSE", "08": "CLOSE_WAIT",
		"09": "LAST_ACK", "0A": "LISTEN", "0B": "CLOSING",
	}
	for _, table := range []struct{ path, protocol string }{
		{"/proc/net/tcp", "TCP"},
		{"/proc/net/tcp6", "TCP6"},
		{"/proc/net/udp", "UDP"},
		{"/proc/net/udp6", "UDP6"},
	} {
		b, err := os.ReadFile(table.path)
		if err != nil {
			continue
		}
		for i, line := range strings.Split(string(b), "\n") {
			if i == 0 {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 10 {
				continue
			}
			local, ok1 := parseHexSockaddr(fields[1])
			remote, ok2 := parseHexSockaddr(fields[2])
			if !ok1 || !ok2 {
				continue
			}
			state := stateNames[fields[3]]
			if table.protocol[0] == 'U' {
				state = "" // UDP 无连接状态
			}
			out[fields[9]] = linuxConnInfo{
				protocol: table.protocol,
				state:    state,
				local:    local,
				remote:   remote,
			}
		}
	}
	// Unix 域套接字：无网络地址，Path 可选
	if b, err := os.ReadFile("/proc/net/unix"); err == nil {
		for i, line := range strings.Split(string(b), "\n") {
			if i == 0 {
				continue
			}
			fields := strings.Fields(line)
			// Num RefCount Protocol Flags Type St Inode [Path]
			if len(fields) < 7 {
				continue
			}
			conn := linuxConnInfo{protocol: "unix"}
			if len(fields) >= 8 {
				conn.local = strings.Join(fields[7:], " ")
			}
			out[fields[6]] = conn
		}
	}
	// netlink 套接字（udev / 内核事件监听等常见于桌面进程的 fd）
	if b, err := os.ReadFile("/proc/net/netlink"); err == nil {
		for i, line := range strings.Split(string(b), "\n") {
			if i == 0 {
				continue
			}
			fields := strings.Fields(line)
			// sk Eth Pid Groups Rmem Wmem Dump Locks Drops Inode
			if len(fields) < 10 {
				continue
			}
			out[fields[9]] = linuxConnInfo{protocol: "netlink"}
		}
	}
	return out
}

// fdAccess 从 /proc/<pid>/fdinfo/<fd> 的 flags 位解析读写模式（O_ACCMODE 低两位）。
func fdAccess(fdInfoPath string) string {
	b, err := os.ReadFile(fdInfoPath)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(line, "flags:"); ok {
			flags, err := strconv.ParseUint(strings.TrimSpace(v), 8, 32)
			if err != nil {
				return ""
			}
			switch flags & 3 {
			case 0:
				return "r"
			case 1:
				return "w"
			default:
				return "rw"
			}
		}
	}
	return ""
}

// fillProcCwds Linux：collectProcs 已随 /proc/<pid>/cwd 读出，无需批量补。
func fillProcCwds(kept []*RawProc) {}

// collectProcDetail Linux：单进程基础字段强刷（监听由 fd 表重新映射）。
func collectProcDetail(pid int, now time.Time) (*RawProc, error) {
	p, err := process.NewProcess(int32(pid))
	if err != nil || !isAliveLinux(pid) {
		return nil, fmt.Errorf("进程不存在: %d", pid)
	}
	uids, err := p.Uids()
	if err != nil || len(uids) == 0 {
		return nil, fmt.Errorf("进程不存在: %d", pid)
	}
	comm, _ := p.Name()
	exe, _ := p.Exe()
	args, _ := p.CmdlineSlice()
	if args == nil {
		args = []string{}
	}
	cwd, _ := p.Cwd()

	rp := &RawProc{
		PID:     pid,
		PPID:    ppidLinux(p),
		User:    lookupUIDName(uids[0]),
		Comm:    comm,
		Exe:     exe,
		Cwd:     cwd,
		Cmd:     strings.Join(args, " "),
		Args:    args,
		Extra:   map[string]string{},
		CPU:     linuxProcCPUPercent(p, pid, now),
		Threads: linuxThreads(pid, now),
	}
	rp.ThreadCount = len(rp.Threads)
	if rp.ThreadCount == 0 {
		if n, err := p.NumThreads(); err == nil && n > 0 {
			rp.ThreadCount = int(n)
		} else {
			rp.ThreadCount = 1
		}
	}
	if mi, err := p.MemoryInfo(); err == nil && mi != nil {
		rp.RSS = mi.RSS
	}
	if ct, err := p.CreateTime(); err == nil && ct > 0 {
		if up := time.Now().Unix() - ct/1000; up > 0 {
			rp.Elapsed = uint64(up)
		}
	}
	if io, err := p.IOCounters(); err == nil && io != nil {
		rp.DiskRead = io.ReadBytes
		rp.DiskWrite = io.WriteBytes
	}
	if nb := procNetBytes(pid); nb.in > 0 || nb.out > 0 {
		rp.NetIn = nb.in
		rp.NetOut = nb.out
	}
	listeners, _ := collectListeners([]int{pid})
	rp.ListenAddresses = listeners[pid]
	for _, address := range rp.ListenAddresses {
		if port := parseListenPort(address); port > 0 {
			rp.Ports = append(rp.Ports, port)
		}
	}
	return rp, nil
}

func isAliveLinux(pid int) bool {
	_, err := os.Stat(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	return err == nil
}

func ppidLinux(p *process.Process) int {
	if pp, err := p.Ppid(); err == nil {
		return int(pp)
	}
	return 0
}

// killProc Linux：仅允许当前用户的进程；SIGTERM / SIGKILL。
func killProc(pid int, force bool) error {
	statusPath := filepath.Join("/proc", strconv.Itoa(pid), "status")
	b, err := os.ReadFile(statusPath)
	if err != nil {
		return fmt.Errorf("进程不存在: %d", pid)
	}
	uid := parseStatusUID(string(b))
	if uid < 0 {
		return fmt.Errorf("无法读取进程 %d 的属主", pid)
	}
	if uid != os.Getuid() {
		return fmt.Errorf("只能结束当前用户(%s)的进程，目标属主为 %s", lookupUIDName(uint32(os.Getuid())), lookupUIDName(uint32(uid)))
	}
	sig := syscall.SIGTERM
	if force {
		sig = syscall.SIGKILL
	}
	if err := syscall.Kill(pid, sig); err != nil {
		return fmt.Errorf("结束进程失败: %w", err)
	}
	return nil
}

// parseStatusUID 取 /proc/<pid>/status 的 Uid 行第一个字段（实际属主）。
func parseStatusUID(raw string) int {
	for _, line := range strings.Split(raw, "\n") {
		if v, ok := strings.CutPrefix(line, "Uid:"); ok {
			fields := strings.Fields(v)
			if len(fields) > 0 {
				if n, err := strconv.Atoi(fields[0]); err == nil {
					return n
				}
			}
			return -1
		}
	}
	return -1
}

// cleanupScanHistory Linux：清理进程 / 线程差分缓存。
func cleanupScanHistory(alive map[int]bool, now time.Time) {
	linuxCPUMu.Lock()
	for pid := range linuxCPUPrev {
		if !alive[pid] {
			delete(linuxCPUPrev, pid)
		}
	}
	linuxCPUMu.Unlock()

	linuxThreadMu.Lock()
	prefixes := make([]uint64, 0, len(alive))
	for pid := range alive {
		prefixes = append(prefixes, uint64(pid)<<32)
	}
	for key := range linuxThreadCPU {
		keep := false
		for _, prefix := range prefixes {
			if key>>32 == prefix>>32 {
				keep = true
				break
			}
		}
		if !keep {
			delete(linuxThreadCPU, key)
		}
	}
	if now.Sub(linuxThreadPrevAt) > 10*time.Minute {
		linuxThreadCPU = map[uint64]uint64{}
	}
	linuxThreadMu.Unlock()
}
