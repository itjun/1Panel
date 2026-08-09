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

// CollectJava 采集 Java 进程列表
// 判定标准：进程的可执行文件名（comm）等于 java，避免误识别命令行内含 "java" 字样的进程
// 实现：ps 输出加 comm 字段，按 comm=="java" 精确过滤
func (c *Collector) CollectJava(host string, opt sshd.ConnectOption) ([]ProcInfo, error) {
	cmd := `ps -eo pid,ppid,user,pcpu,pmem,rss,etime,comm,args --sort=-pcpu | awk '$8=="java"'`
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	return parseProcessesWithComm(string(out)), nil
}

// parseProcessesWithComm 解析带 comm 字段的 ps 输出
// 字段顺序：pid ppid user pcpu pmem rss etime comm args...
func parseProcessesWithComm(s string) []ProcInfo {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) == 0 {
		return nil
	}
	out := make([]ProcInfo, 0, len(lines))
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}
		pid, _ := strconv.ParseUint(fields[0], 10, 32)
		ppid, _ := strconv.ParseUint(fields[1], 10, 32)
		cpu, _ := strconv.ParseFloat(fields[3], 64)
		mem, _ := strconv.ParseFloat(fields[4], 64)
		rssKB, _ := strconv.ParseUint(fields[5], 10, 64)
		elapsedSec := parseElapsedToSeconds(fields[6])
		// fields[7] 是 comm（java），fields[8:] 是完整 args
		cmd := strings.Join(fields[8:], " ")
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
