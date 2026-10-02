package localsys

import (
	"net"
	"strings"

	gnet "github.com/shirou/gopsutil/v4/net"
)

// CollectNetwork 采集本机网卡、地址与默认网关（跨平台主流程，gopsutil）。
// 平台钩子：defaultRoute()（默认网关 / 主网卡）、decorateInterfaces()（展示名与类型）。
func CollectNetwork() (*NetworkSnapshot, error) {
	snap := &NetworkSnapshot{}
	snap.DefaultGateway, snap.PrimaryIface = defaultRoute()

	ifaces, err := gnet.Interfaces()
	if err != nil {
		return nil, err
	}
	counters, _ := gnet.IOCounters(true)
	byName := make(map[string]gnet.IOCountersStat, len(counters))
	for _, c := range counters {
		byName[c.Name] = c
	}

	for _, i := range ifaces {
		if isLoopbackIfaceName(i.Name) || hasFlag(i.Flags, "loopback") {
			continue
		}
		ifc := NetInterface{
			Name:    i.Name,
			Display: i.Name,
			Kind:    "other",
			State:   "down",
			MTU:     i.MTU,
			MAC:     formatMacAddr(i.HardwareAddr),
		}
		if hasFlag(i.Flags, "up") {
			ifc.State = "up"
		}
		for _, a := range i.Addrs {
			ip := parseCIDRIP(a.Addr)
			if ip == nil || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
				continue
			}
			if ip.To4() != nil {
				if ifc.IPv4 == "" {
					ifc.IPv4 = ip.String()
				}
			} else if ifc.IPv6 == "" {
				ifc.IPv6 = ip.String()
			}
		}
		if c, ok := byName[i.Name]; ok {
			ifc.RxBytes = c.BytesRecv
			ifc.TxBytes = c.BytesSent
		}
		snap.Interfaces = append(snap.Interfaces, ifc)
	}
	decorateInterfaces(snap.Interfaces)

	for idx := range snap.Interfaces {
		ifc := &snap.Interfaces[idx]
		if ifc.IPv4 != "" && !isLinkLocalIPv4(ifc.IPv4) {
			snap.PrivateIPs = append(snap.PrivateIPs, ifc.IPv4)
		}
		if snap.PrimaryIface != "" && ifc.Name == snap.PrimaryIface && ifc.IPv4 != "" {
			snap.PrimaryIP = ifc.IPv4
		}
	}
	if snap.PrimaryIP == "" {
		snap.PrimaryIP = primaryIPv4()
	}
	if snap.PrimaryIP == "" && len(snap.PrivateIPs) > 0 {
		snap.PrimaryIP = snap.PrivateIPs[0]
	}
	return snap, nil
}

func isLoopbackIfaceName(name string) bool {
	return name == "" || name == "lo" || name == "lo0"
}

func hasFlag(flags []string, want string) bool {
	for _, f := range flags {
		if strings.EqualFold(f, want) {
			return true
		}
	}
	return false
}

func parseCIDRIP(cidr string) net.IP {
	addr := strings.TrimSpace(cidr)
	if addr == "" {
		return nil
	}
	if i := strings.IndexByte(addr, '/'); i >= 0 {
		addr = addr[:i]
	}
	return net.ParseIP(addr)
}

// formatMacAddr 归一化 MAC 展示（小写冒号分隔；gopsutil 已带冒号）。
func formatMacAddr(addr string) string {
	addr = strings.ToLower(strings.TrimSpace(addr))
	if len(addr) < 17 { // 至少 6 组冒号分隔
		return ""
	}
	return addr
}

func isLinkLocalIPv4(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	return parsed.IsLinkLocalUnicast()
}
