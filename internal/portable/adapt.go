package portable

import (
	"fmt"
	"strings"

	"diteng-pannel/internal/panelstore"
)

// windowsUnsupported Windows 版 OpenSSH 不支持连接复用，保留会导致连接失败
var windowsUnsupported = map[string]bool{
	"controlmaster":  true,
	"controlpath":    true,
	"controlpersist": true,
}

// AdaptHostForOS 剔除目标系统上无效的 SSH 选项，返回调整后的主机与被剔除项说明。
// targetOS 取 runtime.GOOS 的值（darwin / windows / linux）。
func AdaptHostForOS(h panelstore.PanelHost, targetOS string) (panelstore.PanelHost, []string) {
	var dropped []string
	if targetOS != "darwin" && isMacAgent(h.IdentityAgent) {
		dropped = append(dropped, fmt.Sprintf("%s: IdentityAgent %s", h.Alias, h.IdentityAgent))
		h.IdentityAgent = ""
	}
	if len(h.ExtraOptions) > 0 {
		kept := make([]panelstore.SSHOption, 0, len(h.ExtraOptions))
		for _, opt := range h.ExtraOptions {
			key := strings.ToLower(strings.TrimSpace(opt.Key))
			drop := (targetOS != "darwin" && key == "usekeychain") ||
				(targetOS == "windows" && windowsUnsupported[key])
			if drop {
				dropped = append(dropped, fmt.Sprintf("%s: %s %s", h.Alias, opt.Key, opt.Value))
				continue
			}
			kept = append(kept, opt)
		}
		h.ExtraOptions = kept
	}
	return h, dropped
}

func isMacAgent(agent string) bool {
	a := toSlash(strings.TrimSpace(agent))
	return a != "" && (strings.Contains(a, "/Library/") || strings.Contains(a, "com.apple"))
}
