//go:build windows

package localsys

import (
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// defaultRoute Windows：取带网关且 IPv4 度量最小的活动适配器。
func defaultRoute() (gateway, iface string) {
	adapters, err := listAdapters()
	if err != nil {
		return "", ""
	}
	bestGateway := ""
	bestIface := ""
	bestMetric := uint32(^uint32(0))
	for _, a := range adapters {
		gw := a.gateway
		if gw == "" || a.state != "up" {
			continue
		}
		if a.ipv4Metric > 0 && a.ipv4Metric < bestMetric {
			bestMetric = a.ipv4Metric
			bestGateway = gw
			bestIface = a.name
		}
		if bestGateway == "" {
			bestGateway = gw
			bestIface = a.name
		}
	}
	return bestGateway, bestIface
}

// decorateInterfaces Windows：用 GetAdaptersAddresses 的 FriendlyName / 类型补展示名与类型。
// gopsutil 的 Name 是适配器 GUID（AdapterName），需要对照回友好名（如「以太网」「WLAN」）。
func decorateInterfaces(ifcs []NetInterface) {
	adapters, err := listAdapters()
	if err != nil {
		return
	}
	byName := make(map[string]winAdapter, len(adapters))
	for _, a := range adapters {
		byName[a.name] = a
	}
	for i := range ifcs {
		ifc := &ifcs[i]
		a, ok := byName[ifc.Name]
		if !ok {
			continue
		}
		if a.display != "" {
			ifc.Display = a.display
		}
		ifc.Kind = classifyAdapterKind(a.ifType, a.display)
		if ifc.Kind == "loopback" {
			ifc.Kind = "other"
		}
	}
}

type winAdapter struct {
	name       string // AdapterName（GUID 字符串，稳定键）
	display    string // FriendlyName，如「以太网」「WLAN」
	kind       string
	state      string
	mtu        int
	mac        string
	ipv4       string
	ipv6       string
	gateway    string
	ifType     uint32
	ifIndex    uint32
	ipv4Metric uint32
}

func listAdapters() ([]winAdapter, error) {
	const gaaFlags = windows.GAA_FLAG_INCLUDE_ALL_INTERFACES
	var size uint32
	var buf []byte
	for attempt := 0; attempt < 4; attempt++ {
		err := windows.GetAdaptersAddresses(windows.AF_UNSPEC, gaaFlags, 0, nil, &size)
		if err != nil && err != windows.ERROR_BUFFER_OVERFLOW {
			return nil, err
		}
		if size == 0 {
			return nil, nil
		}
		buf = make([]byte, size)
		head := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0]))
		err = windows.GetAdaptersAddresses(windows.AF_UNSPEC, gaaFlags, 0, head, &size)
		if err == nil {
			return parseAdapters(head), nil
		}
		if err != windows.ERROR_BUFFER_OVERFLOW {
			return nil, err
		}
	}
	return nil, windows.ERROR_BUFFER_OVERFLOW
}

func parseAdapters(head *windows.IpAdapterAddresses) []winAdapter {
	var out []winAdapter
	for aa := head; aa != nil; aa = aa.Next {
		a := winAdapter{
			ifType:     aa.IfType,
			ifIndex:    aa.IfIndex,
			mtu:        int(aa.Mtu),
			ipv4Metric: aa.Ipv4Metric,
		}
		if aa.AdapterName != nil {
			a.name = windows.BytePtrToString(aa.AdapterName)
		}
		if aa.FriendlyName != nil {
			a.display = windows.UTF16PtrToString(aa.FriendlyName)
		}
		a.mac = formatMAC(aa.PhysicalAddress[:aa.PhysicalAddressLength])
		if aa.OperStatus == windows.IfOperStatusUp {
			a.state = "up"
		} else {
			a.state = "down"
		}
		a.kind = classifyAdapterKind(aa.IfType, a.display)
		for ua := aa.FirstUnicastAddress; ua != nil; ua = ua.Next {
			ip := ua.Address.IP()
			if ip == nil {
				continue
			}
			if ip.To4() != nil {
				if a.ipv4 == "" && !ip.IsLinkLocalUnicast() {
					a.ipv4 = ip.String()
				}
				continue
			}
			if a.ipv6 == "" && !ip.IsLinkLocalUnicast() {
				a.ipv6 = ip.String()
			}
		}
		for gw := aa.FirstGatewayAddress; gw != nil; gw = gw.Next {
			if ip := gw.Address.IP(); ip != nil && ip.To4() != nil {
				a.gateway = ip.String()
				break
			}
		}
		out = append(out, a)
	}
	return out
}

func formatMAC(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	parts := make([]string, len(b))
	for i, v := range b {
		parts[i] = strings.ToUpper(hexByte(v))
	}
	return strings.Join(parts, ":")
}

func hexByte(v byte) string {
	const digits = "0123456789abcdef"
	return string(digits[v>>4]) + string(digits[v&0xF])
}

func classifyAdapterKind(ifType uint32, display string) string {
	d := strings.ToLower(display)
	switch ifType {
	case windows.IF_TYPE_SOFTWARE_LOOPBACK:
		return "loopback"
	case windows.IF_TYPE_IEEE80211:
		return "wifi"
	case windows.IF_TYPE_ETHERNET_CSMACD:
		return "ethernet"
	case windows.IF_TYPE_TUNNEL, 53, 135, 143:
		return "vpn"
	}
	if strings.Contains(d, "vpn") || strings.Contains(d, "tap") || strings.Contains(d, "tun") {
		return "vpn"
	}
	if strings.Contains(d, "bluetooth") {
		return "other"
	}
	return "other"
}

// ---- GetIfTable2：每接口收发字节数 ----

type ifOctetsPair struct{ rx, tx uint64 }

func ifOctetsByIndex() map[uint32]ifOctetsPair {
	out := map[uint32]ifOctetsPair{}
	var table *windows.MibIfTable2
	if err := windows.GetIfTable2Ex(0, &table); err != nil {
		return out
	}
	defer windows.FreeMibTable(unsafe.Pointer(table))
	count := int(table.NumEntries)
	rows := (*[1 << 20]windows.MibIfRow2)(unsafe.Pointer(&table.Table[0]))
	for i := 0; i < count; i++ {
		row := &rows[i]
		if row.Type == windows.IF_TYPE_SOFTWARE_LOOPBACK {
			continue
		}
		out[row.InterfaceIndex] = ifOctetsPair{rx: row.InOctets, tx: row.OutOctets}
	}
	return out
}

// sumNetOctets 汇总非环回接口的累计收发字节（供 Overview 差分算速率）。
func sumNetOctets() (rx, tx uint64) {
	for _, v := range ifOctetsByIndex() {
		rx += v.rx
		tx += v.tx
	}
	return rx, tx
}
