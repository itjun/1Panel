//go:build darwin

package localapps

import (
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

const lsofPath = "/usr/sbin/lsof"

type lsofEntry struct {
	PID      int
	Command  string
	UID      string
	PPID     int
	FD       string
	Type     string
	Access   string
	Protocol string
	State    string
	Name     string
}

// parseLsofFieldOutput parses NUL-delimited lsof field output. It never splits
// values on whitespace, so paths and command names retain embedded spaces.
func parseLsofFieldOutput(output []byte) []lsofEntry {
	entries := make([]lsofEntry, 0)
	process := lsofEntry{}
	var current *lsofEntry
	flush := func() {
		if current != nil {
			entries = append(entries, *current)
			current = nil
		}
	}

	for _, raw := range bytes.Split(output, []byte{0}) {
		field := strings.TrimLeft(string(raw), "\r\n")
		if len(field) == 0 {
			continue
		}
		code, value := field[0], field[1:]
		switch code {
		case 'p':
			flush()
			pid, _ := strconv.Atoi(value)
			process = lsofEntry{PID: pid}
		case 'f':
			flush()
			current = &lsofEntry{
				PID:     process.PID,
				Command: process.Command,
				UID:     process.UID,
				PPID:    process.PPID,
				FD:      value,
			}
		case 'c':
			if current == nil {
				process.Command = value
			} else {
				current.Command = value
			}
		case 'u':
			if current == nil {
				process.UID = value
			} else {
				current.UID = value
			}
		case 'R':
			ppid, _ := strconv.Atoi(value)
			if current == nil {
				process.PPID = ppid
			} else {
				current.PPID = ppid
			}
		case 't':
			if current != nil {
				current.Type = value
			}
		case 'a':
			if current != nil {
				current.Access = value
			}
		case 'P':
			if current != nil {
				current.Protocol = value
			}
		case 'T':
			if current != nil && strings.HasPrefix(value, "ST=") {
				current.State = strings.TrimPrefix(value, "ST=")
			}
		case 'n':
			if current != nil {
				current.Name = value
			}
		}
	}
	flush()
	return entries
}

func runLsofFields(args ...string) ([]lsofEntry, []string) {
	commandArgs := append([]string{"-nP", "-F0pcuRftanPTDi"}, args...)
	cmd := exec.Command(lsofPath, commandArgs...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	entries := parseLsofFieldOutput(output)
	warning := lsofWarning(err, stderr.String())
	if warning == "" {
		return entries, []string{}
	}
	return entries, []string{warning}
}

func lsofWarning(err error, stderr string) string {
	message := strings.TrimSpace(stderr)
	if err == nil && message == "" {
		return ""
	}
	if errors.Is(err, exec.ErrNotFound) {
		return "找不到 lsof，服务端口和进程资源明细不可用。"
	}
	if strings.Contains(strings.ToLower(message), "operation not permitted") ||
		strings.Contains(strings.ToLower(message), "permission denied") {
		return "部分进程资源受 macOS 权限限制，扫描结果可能不完整。"
	}
	if message == "" && err != nil {
		message = err.Error()
	}
	if message == "" {
		return "lsof 扫描结果可能不完整。"
	}
	return "lsof 扫描结果可能不完整：" + message
}

// collectListeningSockets enumerates TCP listeners in one structured pass.
func collectListeningSockets() (map[int][]string, []string) {
	entries, warnings := runLsofFields("-iTCP", "-sTCP:LISTEN")
	byPID := make(map[int][]string)
	seen := make(map[int]map[string]bool)
	for _, entry := range entries {
		address := formatListenAddress(entry)
		if entry.PID <= 0 || address == "" || parseListenPort(entry.Name) <= 0 {
			continue
		}
		if seen[entry.PID] == nil {
			seen[entry.PID] = make(map[string]bool)
		}
		if !seen[entry.PID][address] {
			seen[entry.PID][address] = true
			byPID[entry.PID] = append(byPID[entry.PID], address)
		}
	}
	for pid := range byPID {
		sort.Strings(byPID[pid])
	}
	return byPID, warnings
}

func formatListenAddress(entry lsofEntry) string {
	name := strings.TrimSpace(entry.Name)
	if name == "" {
		return ""
	}
	state := strings.TrimSpace(entry.State)
	if state != "" && !strings.HasSuffix(strings.ToUpper(name), " ("+strings.ToUpper(state)+")") {
		name += " (" + state + ")"
	}
	protocol := strings.TrimSpace(entry.Protocol)
	if protocol == "" {
		protocol = "TCP"
	}
	return protocol + " " + name
}

func collectWorkingDirectories(pids []int) (map[int]string, []string) {
	pids = uniqueSortedPIDs(pids)
	if len(pids) == 0 {
		return map[int]string{}, []string{}
	}
	pidList := make([]string, 0, len(pids))
	for _, pid := range pids {
		pidList = append(pidList, strconv.Itoa(pid))
	}
	entries, warnings := runLsofFields("-a", "-p", strings.Join(pidList, ","), "-d", "cwd")
	byPID := make(map[int]string, len(entries))
	for _, entry := range entries {
		if entry.PID > 0 && strings.EqualFold(entry.FD, "cwd") && entry.Name != "" {
			byPID[entry.PID] = entry.Name
		}
	}
	return byPID, warnings
}

func uniqueSortedPIDs(pids []int) []int {
	seen := make(map[int]bool, len(pids))
	unique := make([]int, 0, len(pids))
	for _, pid := range pids {
		if pid > 0 && !seen[pid] {
			seen[pid] = true
			unique = append(unique, pid)
		}
	}
	sort.Ints(unique)
	return unique
}

func listProcResources(pid int) (*ResourceSnapshot, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("非法 PID")
	}
	entries, warnings := runLsofFields("-a", "-p", strconv.Itoa(pid))
	resources := make([]ProcResource, 0, len(entries))
	for _, entry := range entries {
		if entry.FD == "" {
			continue
		}
		resource := ProcResource{
			FD:       entry.FD,
			Type:     entry.Type,
			Name:     entry.Name,
			Access:   entry.Access,
			Protocol: entry.Protocol,
			State:    entry.State,
		}
		if entry.Protocol != "" || entry.Type == "IPv4" || entry.Type == "IPv6" {
			resource.LocalAddress, resource.RemoteAddress = splitSocketEndpoints(entry.Name)
		}
		resources = append(resources, resource)
	}
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].FD != resources[j].FD {
			return resources[i].FD < resources[j].FD
		}
		if resources[i].Type != resources[j].Type {
			return resources[i].Type < resources[j].Type
		}
		return resources[i].Name < resources[j].Name
	})
	return &ResourceSnapshot{PID: pid, Resources: resources, Warnings: warnings}, nil
}

func splitSocketEndpoints(name string) (local, remote string) {
	name = strings.TrimSpace(name)
	if i := strings.Index(name, " ("); i >= 0 {
		name = name[:i]
	}
	parts := strings.SplitN(name, "->", 2)
	local = strings.TrimSpace(parts[0])
	if len(parts) == 2 {
		remote = strings.TrimSpace(parts[1])
	}
	return local, remote
}
