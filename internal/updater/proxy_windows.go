//go:build windows

package updater

import (
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// proxyFunc 返回 http.Transport 的 Proxy 函数：环境变量（HTTP(S)_PROXY / NO_PROXY）
// 优先，未命中时回退 Windows 系统代理。Clash / v2rayN 等工具只写系统代理
// （注册表 Internet Settings），从资源管理器启动的 GUI 进程没有代理环境变量，
// 仅走 ProxyFromEnvironment 会直连超时——更新检查静默失败即源于此。
func proxyFunc() func(*http.Request) (*url.URL, error) {
	return func(req *http.Request) (*url.URL, error) {
		if u, err := http.ProxyFromEnvironment(req); err != nil || u != nil {
			return u, err
		}
		return systemProxy(req)
	}
}

// systemProxy 读 HKCU Internet Settings 的静态系统代理（ProxyEnable + ProxyServer）。
// PAC（AutoConfigURL）不解析。每次请求都现读注册表，代理客户端切换无需重启应用。
func systemProxy(req *http.Request) (*url.URL, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return nil, nil
	}
	defer k.Close()

	enabled, _, err := k.GetIntegerValue("ProxyEnable")
	if err != nil || enabled == 0 {
		return nil, nil
	}
	server, _, err := k.GetStringValue("ProxyServer")
	if err != nil {
		return nil, nil
	}
	override, _, _ := k.GetStringValue("ProxyOverride")

	if proxyBypass(req.URL.Hostname(), override) {
		return nil, nil
	}
	addr := pickProxyServer(server, req.URL.Scheme)
	if addr == "" {
		return nil, nil
	}
	if !strings.Contains(addr, "://") {
		if strings.HasPrefix(addr, "socks") {
			addr = "socks5://" + addr
		} else {
			addr = "http://" + addr
		}
	}
	return url.Parse(addr)
}

// pickProxyServer 从 ProxyServer 取请求协议对应的代理地址。
// 两种格式：单地址 "127.0.0.1:7890"（全协议共用），或分协议
// "http=127.0.0.1:7890;https=127.0.0.1:7891;socks=127.0.0.1:7892"。
// https 请求按 https → http → socks 回退。
func pickProxyServer(server, scheme string) string {
	server = strings.TrimSpace(server)
	if server == "" {
		return ""
	}
	if !strings.Contains(server, "=") {
		return server
	}
	perProto := map[string]string{}
	for _, kv := range strings.Split(server, ";") {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		perProto[strings.TrimSpace(strings.ToLower(k))] = strings.TrimSpace(v)
	}
	if v := perProto[scheme]; v != "" {
		return v
	}
	if scheme == "https" {
		if v := perProto["http"]; v != "" {
			return v
		}
	}
	return perProto["socks"]
}

// proxyBypass 按 ProxyOverride 判断主机是否直连。
// "<local>" 表示不含点的主机名直连；其余条目按 glob 匹配，支持
// "*.corp.com"（子域）与 "192.168.*"（Windows 代理客户端常用的网段写法）。
func proxyBypass(host, override string) bool {
	host = strings.ToLower(strings.Trim(host, "[]"))
	for _, ent := range strings.Split(override, ";") {
		ent = strings.ToLower(strings.TrimSpace(ent))
		switch {
		case ent == "":
			continue
		case ent == "<local>":
			if !strings.Contains(host, ".") {
				return true
			}
		default:
			// 无通配的条目按浏览器例外列表惯例：命中自身及其子域
			if globMatch(ent, host) ||
				(!strings.Contains(ent, "*") && strings.HasSuffix(host, "."+ent)) {
				return true
			}
		}
	}
	return false
}

// globMatch 经典双指针通配匹配：* 匹配任意长度（含空）的字符序列。
func globMatch(pattern, s string) bool {
	pi, si, star, mark := 0, 0, -1, 0
	for si < len(s) {
		switch {
		case pi < len(pattern) && (pattern[pi] == s[si]):
			pi++
			si++
		case pi < len(pattern) && pattern[pi] == '*':
			star = pi
			pi++
			mark = si
		case star != -1:
			pi = star + 1
			mark++
			si = mark
		default:
			return false
		}
	}
	for pi < len(pattern) && pattern[pi] == '*' {
		pi++
	}
	return pi == len(pattern)
}
