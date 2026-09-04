package wecom

import (
	"net"
	"os"
	"strings"
)

// LocalSource 本机发送端标识：「Hostname 内网IPv4」。取不到的段省略。
func LocalSource() string {
	host, _ := os.Hostname()
	host = strings.TrimSpace(host)
	ip := localPrivateIPv4()
	switch {
	case host != "" && ip != "":
		return host + " " + ip
	case host != "":
		return host
	default:
		return ip
	}
}

func localPrivateIPv4() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	bestIP := ""
	bestScore := 0
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		score := ifaceScore(iface.Name)
		if score <= 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil {
				continue
			}
			ip4 := ip.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() || !ip4.IsPrivate() {
				continue
			}
			if score > bestScore {
				bestScore = score
				bestIP = ip4.String()
			}
		}
	}
	return bestIP
}

func ifaceScore(name string) int {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "docker") ||
		strings.HasPrefix(n, "br-") ||
		strings.HasPrefix(n, "veth") ||
		strings.HasPrefix(n, "virbr") ||
		strings.HasPrefix(n, "vmnet") ||
		strings.HasPrefix(n, "cni") ||
		strings.Contains(n, "awdl") ||
		strings.HasPrefix(n, "llw") ||
		strings.HasPrefix(n, "dummy"):
		return 0
	case strings.HasPrefix(n, "en") ||
		strings.HasPrefix(n, "eth") ||
		strings.HasPrefix(n, "wlan") ||
		strings.HasPrefix(n, "wl") ||
		strings.Contains(n, "wi-fi") ||
		strings.Contains(n, "ethernet"):
		return 100
	case strings.HasPrefix(n, "utun") ||
		strings.HasPrefix(n, "tun") ||
		strings.HasPrefix(n, "tap") ||
		strings.HasPrefix(n, "wg"):
		return 20
	default:
		return 50
	}
}
