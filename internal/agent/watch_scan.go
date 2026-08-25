package agent

import (
	"os"
	"strconv"
	"strings"
)

type javaProc struct {
	PID      int
	Comm     string
	Cmdline  string
	RSS      uint64
	CPUTicks uint64
	Ports    []int
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
		cmd := strings.ReplaceAll(string(cmdb), "\x00", " ")
		p := javaProc{PID: pid, Comm: name, Cmdline: cmd, RSS: readRSS(base+"/status") * 1024, CPUTicks: readCPUTicks(base + "/stat")}
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

func portsFromCmdline(cmd string) []int {
	var ports []int
	for _, f := range strings.Fields(cmd) {
		if v, ok := strings.CutPrefix(f, "--server.port="); ok {
			n, err := strconv.Atoi(v)
			if err == nil && n > 0 {
				ports = append(ports, n)
			}
		}
	}
	return ports
}
