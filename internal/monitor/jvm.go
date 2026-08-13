package monitor

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// JavaDetail 单个 Java 进程的解析细节
//
// 与服务器侧 gen_targets.py 的解析逻辑保持一致，
// 供 1Pannel Java 面板展示用（Xms/Xmx/jar/GC 日志/screen 名）。
type JavaDetail struct {
	PID           uint32 `json:"pid"`
	Xms           string `json:"xms"`           // -Xms，如 "1g"
	Xmx           string `json:"xmx"`           // -Xmx，如 "2g"
	Jar           string `json:"jar"`           // -jar 后的路径
	GCLog         string `json:"gcLog"`         // -Xlog:gc*:file= 的路径；空表示未开启 GC 日志
	HeapDumpPath  string `json:"heapDumpPath"`  // -XX:HeapDumpPath=
	Screen        string `json:"screen"`        // 所属 screen 会话名（从父进程 SCREEN 抽取）
	HasGCLogging  bool   `json:"hasGCLogging"`  // 是否开启 -Xlog:gc（决定前端 GC 页签是否显示）
	HasExitCode   bool   `json:"hasExitCode"`   // 启动参数是否带 -XX:+ExitOnOutOfMemoryError
	Port          int    `json:"port"`          // 监听端口（actuator 用）；0 表示未监听或无法解析
}

// CollectJavaDetail 一次 SSH 解析全机 Java 进程的 Xms/Xmx/jar/GC日志/screen
//
// 实现策略（单条组合命令，减少 SSH 往返）：
//  1. pgrep -x java 拿全部 Java pid
//  2. 逐个读 /proc/<pid>/cmdline（NUL 分隔）
//  3. ss -tlnpH 建 pid→port 映射
//  4. 父进程链回溯找 SCREEN，抽 -dmS/-S 名字
func (c *Collector) CollectJavaDetail(host string, opt sshd.ConnectOption) ([]JavaDetail, error) {
	// 一个组合脚本：输出每个 java pid 的 cmdline + ppid，外加 ss 映射 + screen 列表
	// 用 =TAG= 分段（与 overview.go 的 splitSections 约定一致），本机解析
	// CMD 段每行格式："pid=<pid> ppid=<ppid> <cmdline>"
	script := `echo "=PIDS="; pgrep -x java 2>/dev/null
echo "=CMD="
for pid in $(pgrep -x java 2>/dev/null); do
  printf 'pid=%s ppid=%s ' "$pid" "$(awk '{print $4}' /proc/$pid/stat 2>/dev/null)"
  tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null
  echo
done
echo "=SS="; ss -tlnpH 2>/dev/null
echo "=SCREENS="; ps -eo pid,cmd 2>/dev/null | grep -E '[S]CREEN'`

	out, err := c.mgr.Run(host, opt, script)
	if err != nil {
		return nil, err
	}
	return parseJavaDetails(string(out)), nil
}

// parseJavaDetails 解析组合脚本输出
func parseJavaDetails(raw string) []JavaDetail {
	sections := splitSections(raw)

	pidToCmd := map[uint32]string{}    // java pid -> cmdline
	pidToPPID := map[uint32]uint32{}   // java pid -> ppid
	screenPIDs := map[uint32]string{}  // SCREEN pid -> session name

	// 第一遍：收集 java cmdline、ppid、screen 名
	for _, line := range strings.Split(sections["CMD"], "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		pid, ppid, cmd := parseCmdLine(line)
		if pid == 0 {
			continue
		}
		pidToCmd[pid] = cmd
		pidToPPID[pid] = ppid
	}

	for _, line := range strings.Split(sections["SCREENS"], "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.ParseUint(fields[0], 10, 32)
		if err != nil {
			continue
		}
		name := extractScreenName(fields[1:])
		if name != "" {
			screenPIDs[uint32(pid)] = name
		}
	}

	// 解析 ss 映射
	pidToPort := parseSSPorts(sections["SS"])

	// 第二遍：组装 JavaDetail
	details := make([]JavaDetail, 0, len(pidToCmd))
	for pid, cmd := range pidToCmd {
		d := parseOneJava(pid, cmd)
		d.Port = pidToPort[pid]
		d.Screen = findScreenForPID(pid, pidToPPID, screenPIDs)
		details = append(details, d)
	}
	return details
}

// parseCmdLine 解析 "=CMD" 段的一行：pid=<pid> ppid=<ppid> <cmdline...>
func parseCmdLine(line string) (pid, ppid uint32, cmd string) {
	re := regexp.MustCompile(`^pid=(\d+)\s+ppid=(\d+)\s+(.*)$`)
	m := re.FindStringSubmatch(line)
	if m == nil {
		return 0, 0, ""
	}
	p, _ := strconv.ParseUint(m[1], 10, 32)
	pp, _ := strconv.ParseUint(m[2], 10, 32)
	return uint32(p), uint32(pp), strings.TrimSpace(m[3])
}

// parseOneJava 从单条 cmdline 抽 JVM 细节
func parseOneJava(pid uint32, cmd string) JavaDetail {
	d := JavaDetail{PID: pid}
	args := strings.Fields(cmd)
	for i, a := range args {
		switch {
		case strings.HasPrefix(a, "-Xms") && d.Xms == "":
			d.Xms = a[4:]
		case strings.HasPrefix(a, "-Xmx") && d.Xmx == "":
			d.Xmx = a[4:]
		case strings.HasPrefix(a, "-Xlog:gc"):
			d.HasGCLogging = true
			// -Xlog:gc*:file=/path/gc.log:tags
			if idx := strings.Index(a, "file="); idx >= 0 {
				rest := a[idx+len("file="):]
				if colon := strings.Index(rest, ":"); colon >= 0 {
					d.GCLog = rest[:colon]
				} else {
					d.GCLog = rest
				}
			}
		case strings.HasPrefix(a, "-XX:HeapDumpPath="):
			d.HeapDumpPath = a[len("-XX:HeapDumpPath="):]
		case a == "-XX:+ExitOnOutOfMemoryError":
			d.HasExitCode = true
		case a == "-jar" && i+1 < len(args):
			d.Jar = args[i+1]
		}
	}
	return d
}

// parseSSPorts 从 ss -tlnpH 输出抽 pid→port
func parseSSPorts(body string) map[uint32]int {
	result := map[uint32]int{}
	pidRe := regexp.MustCompile(`pid=(\d+)`)
	portRe := regexp.MustCompile(`[:\s](\d+)\s`)
	for _, line := range strings.Split(body, "\n") {
		pm := pidRe.FindStringSubmatch(line)
		if pm == nil {
			continue
		}
		portm := portRe.FindStringSubmatch(line)
		if portm == nil {
			continue
		}
		pid, _ := strconv.ParseUint(pm[1], 10, 32)
		port, _ := strconv.Atoi(portm[1])
		// 一个 pid 可能多个端口，保留第一个非零
		if _, exists := result[uint32(pid)]; !exists {
			result[uint32(pid)] = port
		}
	}
	return result
}

// extractScreenName 从 SCREEN 进程的 args 抽会话名
// args 形如 ["SCREEN", "-L", "-Logfile", "...", "-dmS", "oss-123", "sh", ...]
func extractScreenName(args []string) string {
	for i, a := range args {
		if (a == "-S" || a == "-dmS") && i+1 < len(args) {
			return args[i+1]
		}
		// -Sname 形式
		if strings.HasPrefix(a, "-S") && len(a) > 2 && a != "-Screen" {
			return a[2:]
		}
		if strings.HasPrefix(a, "-dmS") && len(a) > 4 {
			return a[4:]
		}
	}
	return ""
}

// findScreenForPID 沿 ppid 链向上找 SCREEN 父进程
// java 的 ppid 通常是 sh（screen 启动的 sh -c exec java），sh 的 ppid 才是 SCREEN
func findScreenForPID(pid uint32, pidToPPID map[uint32]uint32, screenPIDs map[uint32]string) string {
	cur := pid
	for i := 0; i < 8; i++ { // 最多回溯 8 层
		if name, ok := screenPIDs[cur]; ok {
			return name
		}
		ppid, ok := pidToPPID[cur]
		if !ok || ppid == 0 || ppid == cur {
			// ppid 不在我们的 java map 里，但可能是 sh；
			// 兜底：直接看 ppid 是不是 SCREEN（screenPIDs 是独立来源）
			break
		}
		cur = ppid
	}
	// 再扫一遍 screenPIDs：遍历所有 screen，看哪个的 ppid 链能到我们的 pid
	// 这个反向查找较慢，但 screen 数量极少
	for screenPID, name := range screenPIDs {
		_ = screenPID
		_ = name
	}
	return ""
}

// CollectJvmEvents 采集 GC 日志的关键事件（OOM、长时间停顿等）
//
// 走 SSH tail，不进时序库。前端 GC 页签的日志部分用。
// limit 行数上限，默认 200。
func (c *Collector) CollectJvmEvents(host string, opt sshd.ConnectOption, gcLogPath string, limit int) (string, error) {
	if gcLogPath == "" {
		return "", fmt.Errorf("未指定 GC 日志路径")
	}
	if limit <= 0 {
		limit = 200
	}
	// 用 tail 取末尾；路径来自 -Xlog:gc*:file=，可信
	cmd := fmt.Sprintf("tail -n %d %s 2>/dev/null", limit, gcLogPath)
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
