package main

import "strings"

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
