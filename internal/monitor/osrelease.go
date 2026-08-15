package monitor

import (
	"fmt"
	"strings"

	"diteng-pannel/internal/sshd"
)

// DetectOSRelease 只读 /etc/os-release，比 CollectOverview 轻量得多
func (c *Collector) DetectOSRelease(host string, opt sshd.ConnectOption) (string, error) {
	script := `grep -E '^(PRETTY_NAME|NAME)=' /etc/os-release 2>/dev/null | head -n2`
	out, err := c.mgr.Run(host, opt, script)
	if err != nil {
		return "", err
	}
	s := parseOSReleaseText(string(out))
	if s == "" {
		return "", fmt.Errorf("未能识别发行版")
	}
	return s, nil
}

// parseOSReleaseText 从 os-release 风格文本取 PRETTY_NAME（优先）或 NAME
func parseOSReleaseText(s string) string {
	pretty, name := "", ""
	for _, line := range strings.Split(s, "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "PRETTY_NAME=") {
			pretty = unquoteOSField(strings.TrimPrefix(l, "PRETTY_NAME="))
			continue
		}
		if strings.HasPrefix(l, "NAME=") && name == "" {
			name = unquoteOSField(strings.TrimPrefix(l, "NAME="))
		}
	}
	if pretty != "" {
		return pretty
	}
	return name
}

func unquoteOSField(v string) string {
	return strings.Trim(strings.TrimSpace(v), `"`)
}
