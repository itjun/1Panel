//go:build linux

package localsys

import (
	"net"
	"os"
	"strconv"
	"strings"
)

// defaultRoute Linux：/proc/net/route 默认路由（度量最小者）。
func defaultRoute() (gateway, iface string) {
	b, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return "", ""
	}
	return ParseProcNetRoute(string(b))
}

// ParseProcNetRoute 解析 /proc/net/route（供单测）。
// 目的地址列是小端十六进制，"00000000" 即默认路由；网关列同编码。
// 字段序：Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT。
func ParseProcNetRoute(raw string) (gateway, iface string) {
	bestMetric := -1
	for i, line := range strings.Split(raw, "\n") {
		if i == 0 {
			continue // 表头
		}
		fields := strings.Fields(line)
		if len(fields) < 8 || fields[1] != "00000000" {
			continue
		}
		gw := hexLEToIPv4(fields[2])
		if gw == "" {
			continue
		}
		metric, _ := strconv.Atoi(fields[6])
		if bestMetric == -1 || metric < bestMetric {
			bestMetric = metric
			gateway = gw
			iface = fields[0]
		}
	}
	return gateway, iface
}

func hexLEToIPv4(s string) string {
	if len(s) != 8 {
		return ""
	}
	var b [4]byte
	for i := 0; i < 4; i++ {
		v, err := strconv.ParseUint(s[6-2*i:8-2*i], 16, 8)
		if err != nil {
			return ""
		}
		b[i] = byte(v)
	}
	return net.IPv4(b[0], b[1], b[2], b[3]).String()
}

// decorateInterfaces Linux：按 /sys/class/net 判定类型；展示名即内核接口名。
func decorateInterfaces(ifcs []NetInterface) {
	for i := range ifcs {
		ifcs[i].Kind = classifyLinuxIfaceKind(ifcs[i].Name)
	}
}

func classifyLinuxIfaceKind(name string) string {
	n := strings.ToLower(name)
	if n == "" {
		return "other"
	}
	// 无线口存在 phy80211 子目录（比名字前缀可靠）
	if _, err := os.Stat("/sys/class/net/" + n + "/phy80211"); err == nil {
		return "wifi"
	}
	switch {
	case strings.HasPrefix(n, "tun"), strings.HasPrefix(n, "tap"),
		strings.HasPrefix(n, "wg"), strings.HasPrefix(n, "ppp"),
		strings.HasPrefix(n, "ipsec"), strings.HasPrefix(n, "tailscale"):
		return "vpn"
	case strings.HasPrefix(n, "wl"), strings.HasPrefix(n, "wlan"):
		return "wifi"
	case strings.HasPrefix(n, "en"), strings.HasPrefix(n, "eth"),
		strings.HasPrefix(n, "usb"), strings.HasPrefix(n, "em"):
		return "ethernet"
	default:
		return "other"
	}
}
