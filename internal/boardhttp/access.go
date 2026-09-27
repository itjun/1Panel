package boardhttp

import (
	"net"
	"net/http"
	"strings"
)

// AllowClient 仅放行 IPv4 私网（RFC1918）与 loopback。
// 不信任 X-Forwarded-For，避免伪造。公网 IPv4 与非回环 IPv6 一律拒绝。
func AllowClient(r *http.Request) bool {
	if r == nil {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip4 := ip.To4(); ip4 != nil {
		return ip4.IsPrivate() || ip4.IsLoopback()
	}
	return ip.IsLoopback()
}
