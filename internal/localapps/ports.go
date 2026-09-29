package localapps

import (
	"strconv"
	"strings"
)

// 监听地址解析（macOS / Windows 共用）。
// 地址串形如 "TCP 0.0.0.0:8080 (LISTEN)" / "*:3000" / "[::]:443"。

func parseListenPort(address string) int {
	address = strings.TrimSpace(address)
	if address == "" {
		return 0
	}
	if i := strings.IndexByte(address, ' '); i >= 0 {
		if strings.EqualFold(address[:i], "TCP") {
			address = strings.TrimSpace(address[i+1:])
		}
	}
	if i := strings.Index(address, "->"); i >= 0 {
		address = address[:i]
	}
	if i := strings.Index(address, " ("); i >= 0 {
		address = address[:i]
	}
	idx := strings.LastIndex(address, ":")
	if idx < 0 || idx+1 >= len(address) {
		return 0
	}
	portText := address[idx+1:]
	for i, r := range portText {
		if r < '0' || r > '9' {
			portText = portText[:i]
			break
		}
	}
	port, _ := strconv.Atoi(portText)
	return port
}
