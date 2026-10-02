package localapps

import (
	"fmt"
	"os"
	"sync"
	"time"
)

// 本机应用扫描跨平台主流程（macOS / Windows / Linux）：
// 进程枚举、TCP 监听表、工作目录、进程级 IO、结束进程等平台差异由各平台文件提供钩子：
//   - collectProcs / collectProcDetail / collectListeners / fillProcCwds
//   - listProcResources / killProc / cleanupScanHistory

var (
	scanMu     sync.Mutex
	lastScanAt time.Time
)

// Scan 扫描当前用户的开发运行时和 TCP 服务候选并归并。
func Scan() (*Snapshot, error) {
	scanMu.Lock()
	defer scanMu.Unlock()

	now := time.Now()
	lastScanAt = now

	procs, warnings, err := collectProcs(now)
	if err != nil {
		return nil, err
	}
	pids := make([]int, 0, len(procs))
	for i := range procs {
		pids = append(pids, procs[i].PID)
	}
	listeners, listenerWarnings := collectListeners(pids)
	warnings = append(warnings, listenerWarnings...)

	selfPID := os.Getpid()
	kept := make([]*RawProc, 0, len(procs))
	for i := range procs {
		rp := &procs[i]
		rp.ListenAddresses = append([]string(nil), listeners[rp.PID]...)
		for _, address := range rp.ListenAddresses {
			if port := parseListenPort(address); port > 0 {
				rp.Ports = append(rp.Ports, port)
			}
		}
		rp.Ports = uniqueSortedPorts(rp.Ports)

		goInfo := detectGoInfo(rp)
		runtime := DetectRuntime(rp.Comm, rp.Args, rp.Exe, goInfo.isGo)
		if runtime == "" && len(rp.ListenAddresses) == 0 {
			continue
		}
		applyKindEvidence(rp, runtime)
		if rp.PID == selfPID {
			rp.Extra["self"] = "1"
		}
		kept = append(kept, rp)
	}

	fillProcCwds(kept)
	raws := make([]RawProc, 0, len(kept))
	for _, rp := range kept {
		applyRates(rp, now)
		raws = append(raws, *rp)
	}

	apps := GroupApps(raws)

	// 清理已消失进程的速率历史，避免 map 无限增长
	alive := make(map[int]bool, len(raws))
	for _, rp := range raws {
		alive[rp.PID] = true
	}
	for pid := range rateHistory {
		if !alive[pid] {
			delete(rateHistory, pid)
		}
	}
	cleanupScanHistory(alive, now)

	return &Snapshot{
		SampledAt: now.Unix(),
		Apps:      apps,
		Warnings:  warnings,
	}, nil
}

// ProcDetail 返回单个进程的完整详情（强制刷新 cwd / 监听端口）。
func ProcDetail(pid int) (*ProcNode, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("非法 PID")
	}
	scanMu.Lock()
	defer scanMu.Unlock()

	now := time.Now()
	lastScanAt = now

	rp, err := collectProcDetail(pid, now)
	if err != nil {
		return nil, err
	}
	if rp.Extra == nil {
		rp.Extra = map[string]string{}
	}
	rp.Ports = uniqueSortedPorts(rp.Ports)
	goInfo := detectGoInfo(rp)
	runtime := DetectRuntime(rp.Comm, rp.Args, rp.Exe, goInfo.isGo)
	applyKindEvidence(rp, runtime)
	if runtime == "" {
		runtime = "unknown"
	}
	if pid == os.Getpid() {
		rp.Extra["self"] = "1"
	}
	applyRates(rp, now)
	node := rawToProcNode(rp, runtime)
	return &node, nil
}

// Resources 按需查询单个本机进程打开的文件描述符资源。
func Resources(pid int) (*ResourceSnapshot, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("非法 PID")
	}
	return listProcResources(pid)
}

// Kill 结束本机进程；force 为 true 时强杀。属主校验由平台实现负责。
func Kill(pid int, force bool) error {
	if pid <= 0 {
		return fmt.Errorf("非法 PID")
	}
	if pid == os.Getpid() {
		return fmt.Errorf("不能结束本程序自身")
	}
	return killProc(pid, force)
}

// detectGoInfo 无名进程查 Go buildinfo（带 15s 路径缓存），并写入 Extra。
func detectGoInfo(rp *RawProc) goCacheEntry {
	var goInfo goCacheEntry
	if DetectRuntime(rp.Comm, rp.Args, rp.Exe, false) == "" {
		goInfo = lookupGoInfo(rp.Exe)
	}
	rp.IsGo = goInfo.isGo
	if goInfo.isGo {
		if goInfo.module != "" {
			if rp.Extra == nil {
				rp.Extra = map[string]string{}
			}
			rp.Extra["module"] = goInfo.module
		}
		if goInfo.goVersion != "" {
			if rp.Extra == nil {
				rp.Extra = map[string]string{}
			}
			rp.Extra["goVersion"] = goInfo.goVersion
		}
	}
	return goInfo
}

// applyKindEvidence 按识别结果填 kind / confidence / evidence。
// runtime 为空时调用方须保证已有监听地址（服务候选）。
func applyKindEvidence(rp *RawProc, runtime string) {
	if runtime != "" {
		rp.Kind = AppKindRuntime
		rp.Confidence = ConfidenceHigh
		rp.Evidence = []string{"识别到开发运行时：" + runtime}
		return
	}
	rp.Kind = AppKindService
	rp.Confidence = ConfidenceMedium
	rp.Evidence = listenerEvidence(rp.ListenAddresses, rp.Ports)
}
