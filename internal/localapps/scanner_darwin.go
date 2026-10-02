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
	netMu        sync.Mutex
	netBytes     = map[int]struct{ in, out uint64 }{}
	nettopCmd    *exec.Cmd
	nettopStopCh chan struct{}
)

// collectProcs macOS：ps 全量 + libproc 补 exe / 线程 / 磁盘 IO，nettop 补网络计数。
// 只保留当前用户的进程；kind / 监听归并由公共流程完成。
func collectProcs(now time.Time) ([]RawProc, []string, error) {
	ensureNettopLocked()
	warnings := []string{}

	psList, err := listPSProcesses()
	if err != nil {
		return nil, nil, err
	}
	argsByPID, err := listPSArgs()
	if err != nil {
		warnings = append(warnings, "读取进程参数失败: "+err.Error())
		argsByPID = map[int][]string{}
	}

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
		threads := libprocThreads(base.pid)
		if threads == nil {
			threads = threadsFromPS(base.pid)
		}
		rp := RawProc{
			PID:         base.pid,
			PPID:        base.ppid,
			User:        base.user,
			CPU:         base.cpu,
			RSS:         base.rss,
			ThreadCount: len(threads),
			Elapsed:     base.elapsed,
			Comm:        base.comm,
			Exe:         exe,
			Cmd:         strings.Join(args, " "),
			Args:        args,
			Extra:       map[string]string{},
			Threads:     threads,
		}
		if rp.ThreadCount == 0 {
			rp.ThreadCount = 1
		}
		if read, write, ok := libprocDiskIO(base.pid); ok {
			rp.DiskRead = read
			rp.DiskWrite = write
		}
		netMu.Lock()
		if nb, ok := netBytes[base.pid]; ok {
			rp.NetIn = nb.in
			rp.NetOut = nb.out
		}
		netMu.Unlock()
		raws = append(raws, rp)
	}
	return raws, warnings, nil
}

// collectListeners macOS：一次批量 lsof 查监听套接字（性能关键，避免逐进程 lsof）。
func collectListeners(pids []int) (map[int][]string, []string) {
	listeners, warnings := collectListeningSockets()
	return listeners, warnings
}

// fillProcCwds macOS：一次批量 lsof 补候选进程的工作目录。
func fillProcCwds(kept []*RawProc) {
	pids := make([]int, 0, len(kept))
	for _, rp := range kept {
		pids = append(pids, rp.PID)
	}
	cwds, warnings := collectWorkingDirectories(pids)
	if len(warnings) > 0 {
		// 工作目录缺失只影响分组名，不作为扫描警告上报
		_ = warnings
	}
	for _, rp := range kept {
		rp.Cwd = cwds[rp.PID]
	}
}

// collectProcDetail macOS：单进程基础字段，并经 fd 表强刷 cwd / 监听地址。
func collectProcDetail(pid int, now time.Time) (*RawProc, error) {
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
	threads := libprocThreads(pid)
	if threads == nil {
		threads = threadsFromPS(pid)
	}

	rp := &RawProc{
		PID:         base.pid,
		PPID:        base.ppid,
		User:        base.user,
		CPU:         base.cpu,
		RSS:         base.rss,
		ThreadCount: len(threads),
		Elapsed:     base.elapsed,
		Comm:        base.comm,
		Exe:         exe,
		Cmd:         strings.Join(args, " "),
		Args:        args,
		Extra:       map[string]string{},
		Threads:     threads,
	}
	if rp.ThreadCount == 0 {
		rp.ThreadCount = 1
	}
	if read, write, ok := libprocDiskIO(pid); ok {
		rp.DiskRead = read
		rp.DiskWrite = write
	}
	netMu.Lock()
	if nb, ok := netBytes[pid]; ok {
		rp.NetIn = nb.in
		rp.NetOut = nb.out
	}
	netMu.Unlock()

	resourceSnapshot, _ := listProcResources(pid)
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
	return rp, nil
}

// killProc macOS：仅允许当前用户的进程；SIGTERM / SIGKILL。
func killProc(pid int, force bool) error {
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

// cleanupScanHistory macOS：速率历史由公共流程清理，无平台缓存。
func cleanupScanHistory(alive map[int]bool, now time.Time) {}

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
