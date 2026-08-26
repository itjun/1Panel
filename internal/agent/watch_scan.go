package agent

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type javaProc struct {
	PID       int
	Comm      string
	Cmdline   string
	RSS       uint64
	CPUTicks  uint64
	Ports     []int
	StartedAt time.Time // 进程启动时间（尽量从 /proc 推算）
}

func scanJavaProcs(procRoot string) []javaProc {
	if procRoot == "" {
		procRoot = "/proc"
	}
	listen := listenInodePorts(procRoot)
	ents, err := os.ReadDir(procRoot)
	if err != nil {
		return nil
	}
	var out []javaProc
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid <= 0 {
			continue
		}
		base := procRoot + "/" + e.Name()
		comm, err := os.ReadFile(base + "/comm")
		if err != nil {
			continue
		}
		name := strings.TrimSpace(string(comm))
		if name != "java" && name != "bun" && name != "node" && name != "nodejs" {
			continue
		}
		cmdb, err := os.ReadFile(base + "/cmdline")
		if err != nil {
			continue
		}
		cmd := strings.Join(splitCmdline(cmdb), " ")
		p := javaProc{
			PID: pid, Comm: name, Cmdline: cmd,
			RSS: readRSS(base+"/status") * 1024, CPUTicks: readCPUTicks(base + "/stat"),
			StartedAt: readProcStartTime(procRoot, base+"/stat"),
		}
		p.Ports = mergePorts(portsFromCmdline(cmd), portsFromFDs(base+"/fd", listen))
		out = append(out, p)
	}
	return out
}

func listenInodePorts(procRoot string) map[uint64]int {
	m := map[uint64]int{}
	parseTCPListen(procRoot+"/net/tcp", m)
	parseTCPListen(procRoot+"/net/tcp6", m)
	return m
}

func parseTCPListen(path string, m map[uint64]int) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for i, line := range strings.Split(string(b), "\n") {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		if fields[3] != "0A" { // TCP_LISTEN
			continue
		}
		_, portHex, ok := strings.Cut(fields[1], ":")
		if !ok {
			continue
		}
		port, err := strconv.ParseInt(portHex, 16, 32)
		if err != nil || port <= 0 {
			continue
		}
		ino, err := strconv.ParseUint(fields[9], 10, 64)
		if err != nil {
			continue
		}
		m[ino] = int(port)
	}
}

func portsFromFDs(fdDir string, listen map[uint64]int) []int {
	ents, err := os.ReadDir(fdDir)
	if err != nil {
		return nil
	}
	seen := map[int]bool{}
	var ports []int
	for _, e := range ents {
		target, err := os.Readlink(fdDir + "/" + e.Name())
		if err != nil {
			continue
		}
		if !strings.HasPrefix(target, "socket:[") {
			continue
		}
		inoStr := strings.TrimSuffix(strings.TrimPrefix(target, "socket:["), "]")
		ino, err := strconv.ParseUint(inoStr, 10, 64)
		if err != nil {
			continue
		}
		p, ok := listen[ino]
		if !ok || seen[p] {
			continue
		}
		seen[p] = true
		ports = append(ports, p)
	}
	return ports
}

func mergePorts(a, b []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, p := range append(a, b...) {
		if p <= 0 || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

func readRSS(statusPath string) uint64 {
	b, err := os.ReadFile(statusPath)
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(line, "VmRSS:"); ok {
			fields := strings.Fields(v)
			if len(fields) >= 1 {
				n, _ := strconv.ParseUint(fields[0], 10, 64)
				return n
			}
		}
	}
	return 0
}

func readCPUTicks(statPath string) uint64 {
	b, err := os.ReadFile(statPath)
	if err != nil {
		return 0
	}
	s := string(b)
	i := strings.LastIndex(s, ")")
	if i < 0 || i+2 > len(s) {
		return 0
	}
	fields := strings.Fields(s[i+2:])
	if len(fields) < 13 {
		return 0
	}
	ut, _ := strconv.ParseUint(fields[11], 10, 64)
	st, _ := strconv.ParseUint(fields[12], 10, 64)
	return ut + st
}

// readProcStartTime 用 /proc/stat 的 btime + /proc/<pid>/stat 的 starttime（字段 22，HZ=100）
func readProcStartTime(procRoot, statPath string) time.Time {
	b, err := os.ReadFile(statPath)
	if err != nil {
		return time.Time{}
	}
	s := string(b)
	i := strings.LastIndex(s, ")")
	if i < 0 || i+2 > len(s) {
		return time.Time{}
	}
	fields := strings.Fields(s[i+2:])
	// after ")": state ... starttime is index 19 (man proc: field 22 overall = 22-3 = 19 after state at 1?)
	// /proc/pid/stat: (comm) then fields[0]=state, [1]=ppid, ... [19]=starttime (22nd field)
	if len(fields) < 20 {
		return time.Time{}
	}
	startTicks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return time.Time{}
	}
	btime := readBootTime(procRoot + "/stat")
	if btime <= 0 {
		return time.Time{}
	}
	const hz = 100
	return time.Unix(btime+int64(startTicks/hz), 0)
}

func readBootTime(statPath string) int64 {
	b, err := os.ReadFile(statPath)
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(line, "btime "); ok {
			n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
			if err == nil {
				return n
			}
		}
	}
	return 0
}

func portsFromCmdline(cmd string) []int {
	var ports []int
	for _, f := range strings.Fields(cmd) {
		if n := serverPortFromArg(f); n > 0 {
			ports = append(ports, n)
		}
	}
	return ports
}

// serverPortFromArg 解析 --server.port=N / -Dserver.port=N
func serverPortFromArg(a string) int {
	for _, prefix := range []string{"--server.port=", "-Dserver.port="} {
		if v, ok := strings.CutPrefix(a, prefix); ok {
			n, err := strconv.Atoi(v)
			if err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}

func splitCmdline(b []byte) []string {
	var argv []string
	start := 0
	for i := 0; i <= len(b); i++ {
		if i == len(b) || b[i] == 0 {
			if i > start {
				argv = append(argv, string(b[start:i]))
			}
			start = i + 1
		}
	}
	return argv
}
