package boardhttp

import (
	"net"
	"sort"
	"strconv"
	"strings"
)

// PrivateIPv4s 本机当前 UP 网卡上的私网 IPv4（不含 loopback / link-local）。
func PrivateIPv4s() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if skipIface(iface.Name) {
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
			ip4 := ip.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() || !ip4.IsPrivate() {
				continue
			}
			s := ip4.String()
			if _, ok := seen[s]; ok {
				continue
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

func skipIface(name string) bool {
	n := strings.ToLower(name)
	return strings.Contains(n, "docker") ||
		strings.HasPrefix(n, "br-") ||
		strings.HasPrefix(n, "veth") ||
		strings.HasPrefix(n, "virbr") ||
		strings.HasPrefix(n, "vmnet") ||
		strings.HasPrefix(n, "cni") ||
		strings.Contains(n, "awdl") ||
		strings.HasPrefix(n, "llw") ||
		strings.HasPrefix(n, "dummy")
}

// BuildURLs 拼 http://ip:port/group 列表；无私网 IP 时附带 127.0.0.1。
func BuildURLs(port int, group string) []string {
	if port <= 0 {
		port = DefaultPort
	}
	group = strings.Trim(strings.TrimSpace(group), "/")
	ips := PrivateIPv4s()
	if len(ips) == 0 {
		ips = []string{"127.0.0.1"}
	}
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		out = append(out, fmtURL(ip, port, group))
	}
	return out
}

func fmtURL(ip string, port int, group string) string {
	host := ip + ":" + strconv.Itoa(port)
	if group == "" {
		return "http://" + host
	}
	return "http://" + host + "/" + group
}
