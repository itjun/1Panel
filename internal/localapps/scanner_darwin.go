//go:build darwin

package localapps

import (
	"bufio"
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

const nettopIdleStop = 60 * time.Second

var (
	scanMu      sync.Mutex
	lastScanAt  time.Time

	netMu        sync.Mutex
	netBytes     = map[int]struct{ in, out uint64 }{}
	nettopCmd    *exec.Cmd
	nettopStopCh chan struct{}
)

// Scan 扫描当前用户的开发运行时和 TCP 服务候选并归并。
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
	listeners, lsofWarnings := collectListeningSockets()
	warnings = append(warnings, lsofWarnings...)

	selfPID := os.Getpid()
	currentUID := uint64(os.Getuid())
	raws := make([]RawProc, 0, 32)

	for _, base := range psList {
		if base.uid != currentUID {
			continue
		}
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
			if len(listeners[base.pid]) == 0 {
				continue
			}
		}

		kind := AppKindRuntime
		confidence := ConfidenceHigh
		evidence := []string{"识别到开发运行时：" + runtime}
		if runtime == "" {
			runtime = "unknown"
			kind = AppKindService
			confidence = ConfidenceMedium
			evidence = make([]string, 0, len(listeners[base.pid]))
			for _, address := range listeners[base.pid] {
				evidence = append(evidence, "TCP 监听："+address)
			}
		}

		rp := RawProc{
			PID:             base.pid,
			PPID:            base.ppid,
			User:            base.user,
			Kind:            kind,
			Runtime:         runtime,
			Confidence:      confidence,
			Evidence:        evidence,
			CPU:             base.cpu,
			RSS:             base.rss,
			Elapsed:         base.elapsed,
			Comm:            base.comm,
			Exe:             exe,
			Cmd:             strings.Join(args, " "),
			Args:            args,
			ListenAddresses: append([]string(nil), listeners[base.pid]...),
			IsGo:            goInfo.isGo,
			Extra:           map[string]string{},
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

		raws = append(raws, rp)
	}

	// 一次批量 lsof 查询补齐所有候选进程的 cwd，避免逐 PID 启动子进程。
	pids := make([]int, 0, len(raws))
	for i := range raws {
		pids = append(pids, raws[i].PID)
	}
	cwds, cwdWarnings := collectWorkingDirectories(pids)
	warnings = append(warnings, cwdWarnings...)
	for i := range raws {
		rp := &raws[i]
		rp.Cwd = cwds[rp.PID]
		for _, address := range rp.ListenAddresses {
			if port := parseListenPort(address); port > 0 {
				rp.Ports = append(rp.Ports, port)
			}
		}
		rp.Ports = uniqueSortedPorts(rp.Ports)

		if read, write, ok := libprocDiskIO(rp.PID); ok {
			rp.DiskRead = read
			rp.DiskWrite = write
		}
		netMu.Lock()
		if values, ok := netBytes[rp.PID]; ok {
			rp.NetIn = values.in
			rp.NetOut = values.out
		}
		netMu.Unlock()
		applyRates(rp, now)

		threads := libprocThreads(rp.PID)
		if threads == nil {
			threads = threadsFromPS(rp.PID)
		}
		rp.Threads = threads
		rp.ThreadCount = len(threads)
		if rp.ThreadCount == 0 {
			rp.ThreadCount = 1
		}
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

	resourceSnapshot, _ := Resources(pid)
	if resourceSnapshot != nil {
		for _, resource := range resourceSnapshot.Resources {
			if strings.EqualFold(resource.FD, "cwd") {
				rp.Cwd = resource.Name
			}
			if strings.EqualFold(resource.State, "LISTEN") && parseListenPort(resource.Name) > 0 {
				address := formatListenAddress(lsofEntry{
					Name:     resource.Name,
					Protocol: resource.Protocol,
					State:    resource.State,
				})
				rp.ListenAddresses = append(rp.ListenAddresses, address)
				rp.Ports = append(rp.Ports, parseListenPort(resource.Name))
			}
		}
	}
	rp.Ports = uniqueSortedPorts(rp.Ports)
	if runtime != "" {
		rp.Kind = AppKindRuntime
		rp.Confidence = ConfidenceHigh
		rp.Evidence = []string{"识别到开发运行时：" + runtime}
	} else if len(rp.ListenAddresses) > 0 {
		rp.Kind = AppKindService
		rp.Confidence = ConfidenceMedium
		for _, address := range rp.ListenAddresses {
			rp.Evidence = append(rp.Evidence, "TCP 监听："+address)
		}
	}

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
	uid     uint64
	user    string
	cpu     float64
	rss     uint64 // bytes
	elapsed uint64
	comm    string
}

func listPSProcesses() ([]psRow, error) {
	out, err := exec.Command("ps", "-ww", "-axo", "pid=,ppid=,uid=,user=,pcpu=,rss=,etime=,comm=").Output()
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
		// pid ppid uid user pcpu rss etime comm...
		if len(fields) < 8 {
			continue
		}
		pid, err1 := strconv.Atoi(fields[0])
		ppid, err2 := strconv.Atoi(fields[1])
		uid, err3 := strconv.ParseUint(fields[2], 10, 64)
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		cpu, _ := strconv.ParseFloat(fields[4], 64)
		rssKB, _ := strconv.ParseUint(fields[5], 10, 64)
		etime := fields[6]
		comm := strings.Join(fields[7:], " ")
		rows = append(rows, psRow{
			pid:     pid,
			ppid:    ppid,
			uid:     uid,
			user:    fields[3],
			cpu:     cpu,
			rss:     rssKB * 1024,
			elapsed: parseElapsedToSeconds(etime),
			comm:    comm,
		})
	}
	return rows, nil
}

func listPSArgs() (map[int][]string, error) {
	out, err := exec.Command("ps", "-ww", "-axo", "pid=,args=").Output()
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
