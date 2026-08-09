package monitor

import (
	"fmt"
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// CollectProcesses 采集进程列表（按 CPU 排序，前 N 条）
func (c *Collector) CollectProcesses(host string, opt sshd.ConnectOption, limit int) ([]ProcInfo, error) {
	if limit <= 0 {
		limit = 100
	}
	cmd := fmt.Sprintf(
		"ps -eo pid,ppid,user,pcpu,pmem,rss,etime,cmd --sort=-pcpu | head -n %d",
		limit+1,
	)
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	return parseProcesses(string(out)), nil
}

// CollectJava 采集 Java 进程列表（cmd 含 java）
func (c *Collector) CollectJava(host string, opt sshd.ConnectOption) ([]ProcInfo, error) {
	cmd := `ps -eo pid,ppid,user,pcpu,pmem,rss,etime,cmd --sort=-pcpu | grep -iE '\bjava\b|jdk|-jar' | grep -v grep`
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	return parseProcesses(string(out)), nil
}

func parseProcesses(s string) []ProcInfo {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) <= 1 {
		return nil
	}
	// 跳过表头
	out := make([]ProcInfo, 0, len(lines)-1)
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		pid, _ := strconv.ParseUint(fields[0], 10, 32)
		ppid, _ := strconv.ParseUint(fields[1], 10, 32)
		cpu, _ := strconv.ParseFloat(fields[3], 64)
		mem, _ := strconv.ParseFloat(fields[4], 64)
		rssKB, _ := strconv.ParseUint(fields[5], 10, 64)
		elapsedSec := parseElapsedToSeconds(fields[6])
		cmd := strings.Join(fields[7:], " ")
		out = append(out, ProcInfo{
			PID:     uint32(pid),
			PPID:    uint32(ppid),
			User:    fields[2],
			CPU:     cpu,
			Mem:     mem,
			RSS:     rssKB * 1024,
			Elapsed: elapsedSec,
			Cmd:     cmd,
		})
	}
	return out
}

// parseElapsedToSeconds 解析 ps 的 etime 字段
// 形如: "1:23" / "12:34:56" / "1-02:03:04" / "1-02:03:04"
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
