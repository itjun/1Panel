//go:build darwin

package localapps

import (
	"bufio"
	"debug/buildinfo"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	lsofCacheTTL   = 10 * time.Second
	goPathCacheTTL = 15 * time.Second
	nettopIdleStop = 60 * time.Second
)

type rateSample struct {
	at                time.Time
	diskRead          uint64
	diskWrite         uint64
	netIn             uint64
	netOut            uint64
	diskReadKnown     bool
	diskWriteKnown    bool
	netKnown          bool
}

type lsofCacheEntry struct {
	at    time.Time
	cwd   string
	ports []int
}

type goCacheEntry struct {
	at        time.Time
	isGo      bool
	module    string
	goVersion string
}

var (
	scanMu       sync.Mutex
	lastScanAt   time.Time
	rateHistory  = map[int]rateSample{}
	lsofCache    = map[int]lsofCacheEntry{}
	goPathCache  = map[string]goCacheEntry{}

	netMu        sync.Mutex
	netBytes     = map[int]struct{ in, out uint64 }{}
	nettopCmd    *exec.Cmd
	nettopStopCh chan struct{}
)

// Scan 扫描本机常见开发语言进程并归并。
func Scan() (*Snapshot, error) {
	scanMu.Lock()
	defer scanMu.Unlock()

	now := time.Now()
	lastScanAt = now
	ensureNettopLocked()

	warnings := []string{}
	psList, err := listPSProcesses()
	if err != nil {
		return nil, err
	}
	argsByPID, err := listPSArgs()
	if err != nil {
		warnings = append(warnings, "读取进程参数失败: "+err.Error())
		argsByPID = map[int][]string{}
	}

	selfPID := os.Getpid()
	raws := make([]RawProc, 0, 32)

	for _, base := range psList {
		args := argsByPID[base.pid]
		if args == nil {
			args = []string{}
		}
		exe := libprocPidPath(base.pid)
		// 先按 comm 识别解释器；其余进程再查 Go buildinfo（路径缓存 15s）
		runtime := DetectRuntime(base.comm, args, exe, false)
		var goInfo goCacheEntry
		if runtime == "" {
			goInfo = lookupGoInfo(exe)
			runtime = DetectRuntime(base.comm, args, exe, goInfo.isGo)
		}
		if runtime == "" {
			continue
		}

		rp := RawProc{
			PID:     base.pid,
			PPID:    base.ppid,
			User:    base.user,
			CPU:     base.cpu,
			RSS:     base.rss,
			Elapsed: base.elapsed,
			Comm:    base.comm,
			Exe:     exe,
			Cmd:     strings.Join(args, " "),
			Args:    args,
			IsGo:    goInfo.isGo,
			Extra:   map[string]string{},
		}
		if goInfo.isGo {
			if goInfo.module != "" {
				rp.Extra["module"] = goInfo.module
			}
			if goInfo.goVersion != "" {
				rp.Extra["goVersion"] = goInfo.goVersion
			}
		}
		if base.pid == selfPID {
			rp.Extra["self"] = "1"
		}

		// 磁盘 IO
		if r, w, ok := libprocDiskIO(base.pid); ok {
			rp.DiskRead = r
			rp.DiskWrite = w
		}

		// 网络累计（nettop 后台采样）
		netMu.Lock()
		if nb, ok := netBytes[base.pid]; ok {
			rp.NetIn = nb.in
			rp.NetOut = nb.out
		}
		netMu.Unlock()

		// 速率
		applyRates(&rp, now)

		// 线程
		threads := libprocThreads(base.pid)
		if threads == nil {
			threads = threadsFromPS(base.pid)
		}
		rp.Threads = threads
		rp.ThreadCount = len(threads)
		if rp.ThreadCount == 0 {
			rp.ThreadCount = 1
		}

		// cwd / ports：lsof + TTL 缓存；分组（尤其 npm/node）依赖 cwd
		cwd, ports := lookupLsofCached(base.pid, false)
		rp.Cwd = cwd
		rp.Ports = ports

		raws = append(raws, rp)
	}

	apps := GroupApps(raws)

	// 清理已消失进程的速率历史，避免 map 无限增长
	alive := map[int]bool{}
	for _, rp := range raws {
		alive[rp.PID] = true
	}
	for pid := range rateHistory {
		if !alive[pid] {
			delete(rateHistory, pid)
		}
	}
	for pid := range lsofCache {
		if !alive[pid] {
			delete(lsofCache, pid)
		}
	}

	return &Snapshot{
		SampledAt: now.Unix(),
		Apps:      apps,
		Warnings:  warnings,
	}, nil
}

// ProcDetail 返回单个进程的完整详情（强制刷新 cwd/ports）。
func ProcDetail(pid int) (*ProcNode, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("非法 PID")
	}

	scanMu.Lock()
	defer scanMu.Unlock()

	now := time.Now()
	lastScanAt = now
	ensureNettopLocked()

	psList, err := listPSProcesses()
	if err != nil {
		return nil, err
	}
	var base *psRow
	for i := range psList {
		if psList[i].pid == pid {
			base = &psList[i]
			break
		}
	}
	if base == nil {
		return nil, fmt.Errorf("进程不存在: %d", pid)
	}

	argsByPID, _ := listPSArgs()
	args := argsByPID[pid]
	if args == nil {
		args = []string{}
	}
	exe := libprocPidPath(pid)
	goInfo := lookupGoInfo(exe)
	runtime := DetectRuntime(base.comm, args, exe, goInfo.isGo)

	rp := RawProc{
		PID:     base.pid,
		PPID:    base.ppid,
		User:    base.user,
		CPU:     base.cpu,
		RSS:     base.rss,
		Elapsed: base.elapsed,
		Comm:    base.comm,
		Exe:     exe,
		Cmd:     strings.Join(args, " "),
		Args:    args,
		IsGo:    goInfo.isGo,
		Extra:   map[string]string{},
	}
	if goInfo.isGo {
		if goInfo.module != "" {
			rp.Extra["module"] = goInfo.module
		}
		if goInfo.goVersion != "" {
			rp.Extra["goVersion"] = goInfo.goVersion
		}
	}
	if pid == os.Getpid() {
		rp.Extra["self"] = "1"
	}
	if r, w, ok := libprocDiskIO(pid); ok {
		rp.DiskRead = r
		rp.DiskWrite = w
	}
	netMu.Lock()
	if nb, ok := netBytes[pid]; ok {
		rp.NetIn = nb.in
		rp.NetOut = nb.out
	}
	netMu.Unlock()
	applyRates(&rp, now)

	threads := libprocThreads(pid)
	if threads == nil {
		threads = threadsFromPS(pid)
	}
	rp.Threads = threads
	rp.ThreadCount = len(threads)
	if rp.ThreadCount == 0 {
		rp.ThreadCount = 1
	}

	cwd, ports := lookupLsofCached(pid, true)
	rp.Cwd = cwd
	rp.Ports = ports

	if runtime == "" {
		runtime = "unknown"
	}
	node := rawToProcNode(&rp, runtime)
	return &node, nil
}

// Kill 终止指定进程；仅允许当前用户拥有的进程。
// force=false 发送 SIGTERM，true 发送 SIGKILL。
func Kill(pid int, force bool) error {
	if pid <= 0 {
		return fmt.Errorf("非法 PID")
	}
	if pid == os.Getpid() {
		return fmt.Errorf("不能结束本程序自身")
	}

	cur, err := user.Current()
	if err != nil {
		return fmt.Errorf("获取当前用户失败: %w", err)
	}

	psList, err := listPSProcesses()
	if err != nil {
		return err
	}
	var target *psRow
	for i := range psList {
		if psList[i].pid == pid {
			target = &psList[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("进程不存在: %d", pid)
	}
	if target.user != cur.Username {
		return fmt.Errorf("只能结束当前用户(%s)的进程，目标属主为 %s", cur.Username, target.user)
	}

	sig := syscall.SIGTERM
	if force {
		sig = syscall.SIGKILL
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return proc.Signal(sig)
}

// ---------- ps ----------

type psRow struct {
	pid     int
	ppid    int
	user    string
	cpu     float64
	rss     uint64 // bytes
	elapsed uint64
	comm    string
}

func listPSProcesses() ([]psRow, error) {
	out, err := exec.Command("ps", "-axo", "pid=,ppid=,user=,pcpu=,rss=,etime=,comm=").Output()
	if err != nil {
		return nil, fmt.Errorf("ps 失败: %w", err)
	}
	rows := []psRow{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		// pid ppid user pcpu rss etime comm...
		if len(fields) < 7 {
			continue
		}
		pid, err1 := strconv.Atoi(fields[0])
		ppid, err2 := strconv.Atoi(fields[1])
		if err1 != nil || err2 != nil {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[3], 64)
		rssKB, _ := strconv.ParseUint(fields[4], 10, 64)
		etime := fields[5]
		comm := strings.Join(fields[6:], " ")
		rows = append(rows, psRow{
			pid:     pid,
			ppid:    ppid,
			user:    fields[2],
			cpu:     cpu,
			rss:     rssKB * 1024,
			elapsed: parseElapsedToSeconds(etime),
			comm:    comm,
		})
	}
	return rows, nil
}

func listPSArgs() (map[int][]string, error) {
	out, err := exec.Command("ps", "-axo", "pid=,args=").Output()
	if err != nil {
		return nil, err
	}
	m := map[int][]string{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// pid 与 args 之间至少一个空格；args 可能含空格
		sp := strings.IndexByte(line, ' ')
		if sp < 0 {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(line[:sp]))
		if err != nil {
			continue
		}
		argLine := strings.TrimSpace(line[sp+1:])
		if argLine == "" {
			m[pid] = []string{}
			continue
		}
		m[pid] = splitArgsLoose(argLine)
	}
	return m, nil
}

// splitArgsLoose 按空白切分命令行（不做 shell 引号还原；足够用于身份识别）。
func splitArgsLoose(s string) []string {
	return strings.Fields(s)
}

func parseElapsedToSeconds(s string) uint64 {
	days := uint64(0)
	if idx := strings.Index(s, "-"); idx >= 0 {
		days, _ = strconv.ParseUint(s[:idx], 10, 64)
		s = s[idx+1:]
	}
	parts := strings.Split(s, ":")
	if len(parts) == 0 {
		return 0
	}
	var total uint64
	for _, p := range parts {
		v, _ := strconv.ParseUint(p, 10, 64)
		total = total*60 + v
	}
	return days*86400 + total
}

// ---------- 速率 ----------

func applyRates(rp *RawProc, now time.Time) {
	prev, ok := rateHistory[rp.PID]
	sample := rateSample{
		at:             now,
		diskRead:       rp.DiskRead,
		diskWrite:      rp.DiskWrite,
		netIn:          rp.NetIn,
		netOut:         rp.NetOut,
		diskReadKnown:  true,
		diskWriteKnown: true,
		netKnown:       true,
	}
	rateHistory[rp.PID] = sample

	if !ok || prev.at.IsZero() {
		rp.RateKnown = false
		return
	}
	dt := now.Sub(prev.at).Seconds()
	if dt <= 0 {
		rp.RateKnown = false
		return
	}
	rp.RateKnown = true
	rp.DiskReadRate = ratePerSec(rp.DiskRead, prev.diskRead, dt)
	rp.DiskWriteRate = ratePerSec(rp.DiskWrite, prev.diskWrite, dt)
	rp.NetInRate = ratePerSec(rp.NetIn, prev.netIn, dt)
	rp.NetOutRate = ratePerSec(rp.NetOut, prev.netOut, dt)
}

func ratePerSec(cur, prev uint64, dt float64) uint64 {
	if cur < prev {
		// 进程重启或计数器回绕，本轮记 0
		return 0
	}
	return uint64(float64(cur-prev) / dt)
}

// ---------- Go buildinfo 缓存 ----------

func lookupGoInfo(exe string) goCacheEntry {
	if exe == "" {
		return goCacheEntry{}
	}
	if e, ok := goPathCache[exe]; ok && time.Since(e.at) < goPathCacheTTL {
		return e
	}
	e := goCacheEntry{at: time.Now()}
	bi, err := buildinfo.ReadFile(exe)
	if err == nil && bi != nil {
		e.isGo = true
		e.goVersion = bi.GoVersion
		e.module = bi.Path
		if bi.Main.Path != "" {
			e.module = bi.Main.Path
		}
	}
	goPathCache[exe] = e
	return e
}

// ---------- lsof 缓存 ----------

func peekLsofCache(pid int) (cwd string, ports []int, ok bool) {
	e, hit := lsofCache[pid]
	if !hit || time.Since(e.at) >= lsofCacheTTL {
		return "", nil, false
	}
	return e.cwd, append([]int(nil), e.ports...), true
}

func lookupLsofCached(pid int, force bool) (cwd string, ports []int) {
	if !force {
		if c, p, ok := peekLsofCache(pid); ok {
			return c, p
		}
	}
	cwd, ports = fetchLsof(pid)
	lsofCache[pid] = lsofCacheEntry{at: time.Now(), cwd: cwd, ports: ports}
	return cwd, append([]int(nil), ports...)
}

func fetchLsof(pid int) (cwd string, ports []int) {
	ports = []int{}
	// cwd
	out, err := exec.Command("lsof", "-a", "-p", strconv.Itoa(pid), "-d", "cwd", "-Fn").Output()
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(line, "n") {
				cwd = strings.TrimPrefix(line, "n")
				break
			}
		}
	}
	// 监听端口
	// -P -n：端口与地址保持数字，避免被解析成服务名导致取端口失败
	out2, err2 := exec.Command("lsof", "-a", "-p", strconv.Itoa(pid), "-iTCP", "-sTCP:LISTEN", "-P", "-n", "-Fn").Output()
	if err2 != nil {
		return cwd, ports
	}
	seen := map[int]bool{}
	for _, line := range strings.Split(string(out2), "\n") {
		if !strings.HasPrefix(line, "n") {
			continue
		}
		addr := strings.TrimPrefix(line, "n")
		// 形如 *:8080 / 127.0.0.1:3000 / [::1]:8080
		port := parseListenPort(addr)
		if port > 0 && !seen[port] {
			seen[port] = true
			ports = append(ports, port)
		}
	}
	return cwd, ports
}

func parseListenPort(addr string) int {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return 0
	}
	// 去掉可能的协议前缀 "TCP "
	if i := strings.IndexByte(addr, ' '); i >= 0 {
		addr = addr[i+1:]
	}
	if strings.HasPrefix(addr, "[") {
		// [ipv6]:port
		rb := strings.LastIndex(addr, "]:")
		if rb < 0 {
			return 0
		}
		p, _ := strconv.Atoi(addr[rb+2:])
		return p
	}
	idx := strings.LastIndex(addr, ":")
	if idx < 0 {
		return 0
	}
	p, _ := strconv.Atoi(addr[idx+1:])
	return p
}

// ---------- 线程：ps -M 退化 ----------

func threadsFromPS(pid int) []ThreadNode {
	out, err := exec.Command("ps", "-M", "-p", strconv.Itoa(pid), "-o", "pid=,pcpu=,state=,command=").Output()
	if err != nil {
		return []ThreadNode{}
	}
	threads := []ThreadNode{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		// 主线程行通常以 pid 开头；子线程行可能没有 pid（缩进）
		cpuIdx := 0
		nameStart := 0
		if len(fields) >= 4 {
			if _, err := strconv.Atoi(fields[0]); err == nil {
				// pid pcpu state command...
				cpuIdx = 1
				nameStart = 3
			} else {
				// pcpu state command...
				cpuIdx = 0
				nameStart = 2
			}
		} else if len(fields) >= 3 {
			cpuIdx = 0
			nameStart = 2
		} else {
			continue
		}
		if cpuIdx >= len(fields) || nameStart > len(fields) {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[cpuIdx], 64)
		state := ""
		if cpuIdx+1 < len(fields) {
			state = fields[cpuIdx+1]
		}
		name := ""
		if nameStart < len(fields) {
			name = filepath.Base(fields[nameStart])
		}
		// ps -M 无真实 tid；用行序合成，避免前端 thr:pid:0 键冲突
		threads = append(threads, ThreadNode{
			TID:   uint64(len(threads) + 1),
			Name:  name,
			CPU:   cpu,
			State: state,
		})
	}
	return threads
}

// ---------- nettop 后台采样 ----------

func ensureNettopLocked() {
	netMu.Lock()
	defer netMu.Unlock()
	if nettopCmd != nil && nettopCmd.Process != nil {
		return
	}
	cmd := exec.Command("nettop", "-L", "0", "-P", "-x", "-n", "-s", "3")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		return
	}
	nettopCmd = cmd
	stopCh := make(chan struct{})
	nettopStopCh = stopCh

	go func() {
		sc := bufio.NewScanner(stdout)
		// 单行可能很长，放大 buffer
		buf := make([]byte, 0, 64*1024)
		sc.Buffer(buf, 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "time,") || line == "" {
				continue
			}
			parseNettopLine(line)
		}
	}()

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				scanMu.Lock()
				idle := time.Since(lastScanAt) > nettopIdleStop
				scanMu.Unlock()
				if !idle {
					continue
				}
				stopNettop()
				return
			}
		}
	}()
}

func stopNettop() {
	netMu.Lock()
	defer netMu.Unlock()
	if nettopCmd == nil {
		return
	}
	if nettopStopCh != nil {
		select {
		case <-nettopStopCh:
		default:
			close(nettopStopCh)
		}
	}
	if nettopCmd.Process != nil {
		_ = nettopCmd.Process.Kill()
		_, _ = nettopCmd.Process.Wait()
	}
	nettopCmd = nil
	nettopStopCh = nil
}

func parseNettopLine(line string) {
	// CSV: time,process.pid,,,bytes_in,bytes_out,...
	parts := strings.Split(line, ",")
	if len(parts) < 6 {
		return
	}
	procField := parts[1]
	dot := strings.LastIndex(procField, ".")
	if dot < 0 || dot+1 >= len(procField) {
		return
	}
	pid, err := strconv.Atoi(procField[dot+1:])
	if err != nil {
		return
	}
	in, err1 := strconv.ParseUint(parts[4], 10, 64)
	out, err2 := strconv.ParseUint(parts[5], 10, 64)
	if err1 != nil || err2 != nil {
		return
	}
	netMu.Lock()
	netBytes[pid] = struct{ in, out uint64 }{in: in, out: out}
	netMu.Unlock()
}
