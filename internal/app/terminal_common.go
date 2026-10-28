package app

import (
	"runtime"
	"strings"
)

// TerminalApp 是设置页可以选用的一个终端。
type TerminalApp struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	SupportsWindow bool   `json:"supportsWindow"`
	Default        bool   `json:"default"`
}

// chooseListedTerminal 优先使用用户选择，未选择时使用默认项。
func chooseListedTerminal(apps []TerminalApp, terminalID, fallbackID string) string {
	if terminalID != "" {
		return terminalID
	}
	if len(apps) == 0 {
		return ""
	}
	for _, app := range apps {
		if app.ID == fallbackID {
			return app.ID
		}
	}
	return apps[0].ID
}

func listTerminalApps() []TerminalApp {
	switch runtime.GOOS {
	case "darwin":
		return listTerminalAppsDarwin()
	case "windows":
		return listTerminalAppsWindows()
	case "linux":
		return listTerminalAppsLinux()
	default:
		return []TerminalApp{}
	}
}

func markDefaultTerminal(apps []TerminalApp, id string) {
	if len(apps) == 0 {
		return
	}
	for i := range apps {
		if apps[i].ID == id {
			apps[i].Default = true
			return
		}
	}
	apps[0].Default = true
}

// normalizeTerminalHosts 清洗前端传来的主机列表：去空白、丢弃含空白与
// 引号等危险字符的条目，防止它们串位到终端程序的参数里。
func normalizeTerminalHosts(hosts []string) []string {
	out := make([]string, 0, len(hosts))
	for _, host := range hosts {
		alias := strings.TrimSpace(host)
		// ssh Host 别名按语法不含空白与换行
		if alias == "" || strings.ContainsAny(alias, " \t\r\n\"';") {
			continue
		}
		out = append(out, alias)
	}
	return out
}
