//go:build darwin

package localsys

import (
	"bufio"
	"net"
	"os/exec"
	"strconv"
	"strings"
)

// CollectNetwork 采集本机网卡与默认网关信息。
func CollectNetwork() (*NetworkSnapshot, error) {
	ports := parseHardwarePorts(runCmd("networksetup", "-listallhardwareports"))
	ifaces := parseIfconfig(runCmd("ifconfig"))
	// -n：禁止反向 DNS；无 -n 时 netstat -ib 常卡数秒
	bytesMap := parseNetstatIB(runCmd("netstat", "-ibn"))

	// 合并
	byDev := map[string]*NetInterface{}
	for i := range ifaces {
		ifc := ifaces[i]
		byDev[ifc.Name] = &ifc
	}
	for _, p := range ports {
		ifc, ok := byDev[p.device]
		if !ok {
			ifc = &NetInterface{Name: p.device}
			byDev[p.device] = ifc
		}
		ifc.Display = p.port
		ifc.MAC = p.mac
		ifc.Kind = classifyKind(p.port, p.device)
	}
	for name, ifc := range byDev {
		if ifc.Kind == "" {
			ifc.Kind = classifyKind(ifc.Display, name)
		}
		if ifc.Display == "" {
			ifc.Display = name
		}
		if b, ok := bytesMap[name]; ok {
			ifc.RxBytes = b.rx
			ifc.TxBytes = b.tx
		}
	}

	snap := &NetworkSnapshot{}
	gw, primaryIface := parseDefaultRoute(runCmd("route", "-n", "get", "default"))
	snap.DefaultGateway = gw
	snap.PrimaryIface = primaryIface
	if primaryIface != "" {
		if ipOut, err := exec.Command("ipconfig", "getifaddr", primaryIface).Output(); err == nil {
			snap.PrimaryIP = strings.TrimSpace(string(ipOut))
		}
	}

	// 稳定顺序：先有 hardware port 的，再其它
	order := []string{}
	seen := map[string]bool{}
	for _, p := range ports {
		if !seen[p.device] {
			order = append(order, p.device)
			seen[p.device] = true
		}
	}
	for name := range byDev {
		if !seen[name] {
			order = append(order, name)
			seen[name] = true
		}
	}
	for _, name := range order {
		ifc := byDev[name]
		if ifc == nil {
			continue
		}
		// 跳过无用 loopback / 空
		if name == "lo0" || name == "lo" {
			continue
		}
		snap.Interfaces = append(snap.Interfaces, *ifc)
		if ifc.IPv4 != "" && !isLinkLocal(ifc.IPv4) {
			snap.PrivateIPs = append(snap.PrivateIPs, ifc.IPv4)
		}
	}
	if snap.PrimaryIP == "" && len(snap.PrivateIPs) > 0 {
		snap.PrimaryIP = snap.PrivateIPs[0]
	}
	return snap, nil
}

type hwPort struct {
	port   string
	device string
	mac    string
}

func parseHardwarePorts(raw string) []hwPort {
	var out []hwPort
	var cur hwPort
	flush := func() {
		if cur.device != "" {
			out = append(out, cur)
		}
		cur = hwPort{}
	}
	sc := bufio.NewScanner(strings.NewReader(raw))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			flush()
			continue
		}
		if v, ok := strings.CutPrefix(line, "Hardware Port:"); ok {
			flush()
			cur.port = strings.TrimSpace(v)
			continue
		}
		if v, ok := strings.CutPrefix(line, "Device:"); ok {
			cur.device = strings.TrimSpace(v)
			continue
		}
		if v, ok := strings.CutPrefix(line, "Ethernet Address:"); ok {
			cur.mac = strings.TrimSpace(v)
		}
	}
	flush()
	return out
}

func parseIfconfig(raw string) []NetInterface {
	var out []NetInterface
	var cur *NetInterface
	flush := func() {
		if cur != nil && cur.Name != "" {
			out = append(out, *cur)
		}
		cur = nil
	}
	sc := bufio.NewScanner(strings.NewReader(raw))
	for sc.Scan() {
		line := sc.Text()
		if len(line) > 0 && line[0] != '\t' && line[0] != ' ' {
			flush()
			name := strings.Split(line, ":")[0]
			cur = &NetInterface{Name: name, State: "down"}
			if strings.Contains(line, "status: active") || strings.Contains(line, "<UP,") {
				cur.State = "up"
			}
			continue
		}
		if cur == nil {
			continue
		}
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "ether ") {
			cur.MAC = strings.TrimSpace(strings.TrimPrefix(trim, "ether "))
		}
		if strings.HasPrefix(trim, "inet ") {
			fields := strings.Fields(trim)
			if len(fields) >= 2 {
				cur.IPv4 = fields[1]
			}
		}
		if strings.HasPrefix(trim, "inet6 ") {
			fields := strings.Fields(trim)
			if len(fields) >= 2 && cur.IPv6 == "" && !strings.HasPrefix(fields[1], "fe80") {
				cur.IPv6 = fields[1]
			}
		}
		if strings.HasPrefix(trim, "status:") {
			st := strings.TrimSpace(strings.TrimPrefix(trim, "status:"))
			if st == "active" {
				cur.State = "up"
			} else {
				cur.State = "down"
			}
		}
		if strings.Contains(trim, "mtu ") {
			idx := strings.Index(trim, "mtu ")
			rest := strings.Fields(trim[idx+4:])
			if len(rest) > 0 {
				cur.MTU, _ = strconv.Atoi(rest[0])
			}
		}
	}
	flush()
	return out
}

type ifaceBytes struct{ rx, tx uint64 }

func parseNetstatIB(raw string) map[string]ifaceBytes {
	out := map[string]ifaceBytes{}
	sc := bufio.NewScanner(strings.NewReader(raw))
	first := true
	for sc.Scan() {
		line := sc.Text()
		if first {
			first = false
			continue
		}
		fields := strings.Fields(line)
		// Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
		if len(fields) < 10 {
			continue
		}
		name := fields[0]
		// 只取 Link 行（有 MAC 或 <Link#）
		if !strings.Contains(fields[2], "<Link") && fields[2] != "Link" {
			// 有些 macOS 版本 Address 列是 MAC
			if !strings.Contains(fields[3], ":") && !strings.Contains(fields[2], "Link") {
				continue
			}
		}
		rx, _ := strconv.ParseUint(fields[6], 10, 64)
		tx, _ := strconv.ParseUint(fields[9], 10, 64)
		out[name] = ifaceBytes{rx: rx, tx: tx}
	}
	return out
}

func parseDefaultRoute(raw string) (gateway, iface string) {
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if v, ok := strings.CutPrefix(line, "gateway:"); ok {
			gateway = strings.TrimSpace(v)
		}
		if v, ok := strings.CutPrefix(line, "interface:"); ok {
			iface = strings.TrimSpace(v)
		}
	}
	return gateway, iface
}

func classifyKind(portName, device string) string {
	p := strings.ToLower(portName)
	d := strings.ToLower(device)
	switch {
	case strings.Contains(p, "wi-fi") || strings.Contains(p, "wifi") || d == "en0" && strings.Contains(p, "wi"):
		return "wifi"
	case strings.HasPrefix(d, "utun") || strings.HasPrefix(d, "ipsec") || strings.Contains(p, "vpn"):
		return "vpn"
	case strings.Contains(p, "thunderbolt") || strings.Contains(p, "bridge"):
		return "thunderbolt"
	case strings.Contains(p, "ethernet") || strings.Contains(p, "usb") || strings.Contains(p, "lan"):
		return "ethernet"
	case strings.HasPrefix(d, "en"):
		if strings.Contains(p, "wi-fi") || strings.Contains(p, "wifi") {
			return "wifi"
		}
		return "ethernet"
	default:
		return "other"
	}
}

func isLinkLocal(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	return parsed.IsLinkLocalUnicast()
}

func runCmd(name string, args ...string) string {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return string(out)
	}
	return string(out)
}

// ParseHardwarePortsForTest 导出解析函数供单测。
func ParseHardwarePortsForTest(raw string) int {
	return len(parseHardwarePorts(raw))
}