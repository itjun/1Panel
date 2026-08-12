package monitor

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"
)

// CollectLog 读取指定类型日志的末尾 N 行
// logType: system / auth / kernel / nginx_access / nginx_error
func (c *Collector) CollectLog(host, logType string, opt sshd.ConnectOption, lines int) (LogResult, error) {
	if lines <= 0 || lines > 5000 {
		lines = 500
	}
	script := buildLogScript(logType, lines)
	out, err := c.mgr.Run(host, opt, script, sshd.RunOptions{Timeout: 15 * time.Second})
	if err != nil {
		return LogResult{}, err
	}
	return parseLogResult(string(out)), nil
}

// buildLogScript 按 logType 生成 shell 脚本，统一输出 =SOURCE= / =CONTENT= 标记
// logType 白名单 switch，非匹配类型返回空内容
func buildLogScript(logType string, lines int) string {
	n := strconv.Itoa(lines)
	switch logType {
	case "system":
		// journalctl 优先，fallback /var/log/syslog（Debian）→ /var/log/messages（RHEL）
		return fmt.Sprintf(
			`if command -v journalctl >/dev/null 2>&1; then echo "=SOURCE=journalctl"; echo "=CONTENT="; journalctl --no-pager -n %[1]s 2>/dev/null; elif [ -f /var/log/syslog ]; then echo "=SOURCE=/var/log/syslog"; echo "=CONTENT="; tail -n %[1]s /var/log/syslog; elif [ -f /var/log/messages ]; then echo "=SOURCE=/var/log/messages"; echo "=CONTENT="; tail -n %[1]s /var/log/messages; else echo "=SOURCE="; echo "=CONTENT="; fi`,
			n)
	case "auth":
		// /var/log/auth.log（Debian）→ /var/log/secure（RHEL）
		return fmt.Sprintf(
			`if [ -f /var/log/auth.log ]; then echo "=SOURCE=/var/log/auth.log"; echo "=CONTENT="; tail -n %[1]s /var/log/auth.log; elif [ -f /var/log/secure ]; then echo "=SOURCE=/var/log/secure"; echo "=CONTENT="; tail -n %[1]s /var/log/secure; else echo "=SOURCE="; echo "=CONTENT="; fi`,
			n)
	case "kernel":
		return fmt.Sprintf(
			`echo "=SOURCE=dmesg"; echo "=CONTENT="; dmesg 2>/dev/null | tail -n %[1]s`,
			n)
	case "nginx_access":
		return fmt.Sprintf(
			`if [ -f /var/log/nginx/access.log ]; then echo "=SOURCE=/var/log/nginx/access.log"; echo "=CONTENT="; tail -n %[1]s /var/log/nginx/access.log; else echo "=SOURCE="; echo "=CONTENT="; fi`,
			n)
	case "nginx_error":
		return fmt.Sprintf(
			`if [ -f /var/log/nginx/error.log ]; then echo "=SOURCE=/var/log/nginx/error.log"; echo "=CONTENT="; tail -n %[1]s /var/log/nginx/error.log; else echo "=SOURCE="; echo "=CONTENT="; fi`,
			n)
	default:
		return `echo "=SOURCE="; echo "=CONTENT="`
	}
}

// parseLogResult 解析 =SOURCE= / =CONTENT= 标记格式
func parseLogResult(s string) LogResult {
	result := LogResult{}
	lines := strings.Split(s, "\n")
	contentStart := -1
	for i, line := range lines {
		if strings.HasPrefix(line, "=SOURCE=") {
			result.Source = strings.TrimPrefix(line, "=SOURCE=")
		}
		if strings.HasPrefix(line, "=CONTENT=") {
			contentStart = i + 1
			break
		}
	}
	if contentStart >= 0 && contentStart < len(lines) {
		result.Content = strings.TrimRight(strings.Join(lines[contentStart:], "\n"), "\n")
	}
	return result
}
