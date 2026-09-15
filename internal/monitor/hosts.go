package monitor

import (
	"fmt"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"
)

// CollectHosts 读取并解析目标主机 /etc/hosts（只读）。
func (c *Collector) CollectHosts(host string, opt sshd.ConnectOption) (HostsInfo, error) {
	out, err := c.mgr.Run(host, opt, `cat /etc/hosts 2>/dev/null`, sshd.RunOptions{Timeout: 10 * time.Second})
	if err != nil {
		return HostsInfo{}, err
	}
	raw := strings.TrimRight(string(out), "\n")
	if raw == "" {
		return HostsInfo{}, fmt.Errorf("无法读取 /etc/hosts")
	}
	return HostsInfo{Raw: raw, Entries: ParseHosts(raw)}, nil
}

// ParseHosts 解析 hosts 文件内容为条目列表（与 localsys.ParseHosts 同规则）。
func ParseHosts(raw string) []HostEntry {
	var entries []HostEntry
	for _, line := range strings.Split(raw, "\n") {
		orig := line
		trim := strings.TrimSpace(line)
		if trim == "" {
			continue
		}
		disabled := false
		body := trim
		comment := ""
		if strings.HasPrefix(trim, "#") {
			// 可能是被注释的有效行：# 127.0.0.1 foo
			rest := strings.TrimSpace(strings.TrimPrefix(trim, "#"))
			if rest == "" {
				continue
			}
			fields := strings.Fields(rest)
			if len(fields) >= 2 && looksLikeIP(fields[0]) {
				disabled = true
				body = rest
			} else {
				continue
			}
		}
		if i := strings.Index(body, "#"); i >= 0 {
			comment = strings.TrimSpace(body[i+1:])
			body = strings.TrimSpace(body[:i])
		}
		fields := strings.Fields(body)
		if len(fields) < 2 || !looksLikeIP(fields[0]) {
			continue
		}
		entries = append(entries, HostEntry{
			IP:       fields[0],
			Names:    fields[1:],
			Comment:  comment,
			Disabled: disabled,
			Raw:      orig,
		})
	}
	return entries
}

func looksLikeIP(s string) bool {
	if strings.Contains(s, ":") {
		// 粗略 IPv6
		return true
	}
	parts := strings.Split(s, ".")
	if len(parts) != 4 {
		return false
	}
	for _, p := range parts {
		if p == "" {
			return false
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return false
			}
		}
	}
	return true
}
