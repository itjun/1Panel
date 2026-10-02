//go:build darwin

package localsys

import (
	"bufio"
	"os/exec"
	"strconv"
	"strings"
)

// defaultRoute macOS：route -n get default。
func defaultRoute() (gateway, iface string) {
	return parseDefaultRoute(runCmd("route", "-n", "get", "default"))
}

// decorateInterfaces macOS：用 networksetup 的硬件端口名补展示名（如 Wi-Fi）与类型。
func decorateInterfaces(ifcs []NetInterface) {
	ports := parseHardwarePorts(runCmd("networksetup", "-listallhardwareports"))
	byDev := make(map[string]hwPort, len(ports))
	for _, p := range ports {
		byDev[p.device] = p
	}
	for i := range ifcs {
		ifc := &ifcs[i]
		p, ok := byDev[ifc.Name]
		if !ok {
			ifc.Kind = classifyKind(ifc.Display, ifc.Name)
			continue
		}
		ifc.Display = p.port
		if ifc.MAC == "" {
			ifc.MAC = p.mac
		}
		ifc.Kind = classifyKind(p.port, ifc.Name)
	}
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
