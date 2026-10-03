package speedtest

import (
	"net"
	"regexp"
	"strconv"
	"strings"
)

// 地址类别
const (
	KindLAN     = "lan"     // RFC1918 私网
	KindOverlay = "overlay" // 100.64/10：Tailscale 等虚拟内网
	KindWAN     = "wan"     // 公网
)

// 地址来源
const (
	SourceIface    = "iface"    // 网卡上真实存在
	SourceHostName = "hostname" // SSH HostName（面板就是用它连上的）
	SourceEgress   = "egress"   // 出口公网 IP（可能经过 NAT）
)

// Addr 端点的一个 IPv4 地址
type Addr struct {
	IP     string `json:"ip"`
	Prefix int    `json:"prefix"` // 0 表示网段未知（来自 HostName / 出口 IP）
	Iface  string `json:"iface,omitempty"`
	Kind   string `json:"kind"`
	Source string `json:"source"`
}

// CIDR 展示用：有网段时带 /prefix
func (a Addr) CIDR() string {
	if a.Prefix > 0 {
		return a.IP + "/" + strconv.Itoa(a.Prefix)
	}
	return a.IP
}

// Network 网段（如 192.168.60.0/24）；网段未知时为空
func (a Addr) Network() string {
	if a.Prefix <= 0 {
		return ""
	}
	_, n, err := net.ParseCIDR(a.CIDR())
	if err != nil {
		return ""
	}
	return n.String()
}

var (
	cgnatNet     = mustCIDR("100.64.0.0/10")
	benchmarkNet = mustCIDR("198.18.0.0/15") // Clash/Surge 等 TUN 的 fake-ip 段，不是真实网络
)

func mustCIDR(s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(err)
	}
	return n
}

// classifyIP 返回地址类别；空串表示不参与测速（回环、链路本地、组播、fake-ip 等）
func classifyIP(ip net.IP) string {
	ip = ip.To4()
	if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified() {
		return ""
	}
	if benchmarkNet.Contains(ip) {
		return ""
	}
	if ip.IsPrivate() {
		return KindLAN
	}
	if cgnatNet.Contains(ip) {
		return KindOverlay
	}
	return KindWAN
}

// skipIface 容器 / 虚拟网桥网卡不参与（docker0、br-xxx、veth 等只在本机可见）
func skipIface(name string) bool {
	for _, p := range []string{"docker", "br-", "veth", "cni", "flannel", "virbr", "lxc", "vnet", "kube", "cali"} {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return name == "lo" || name == "lo0"
}

var reIPAddr = regexp.MustCompile(`^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/(\d+)`)

// parseIPAddr 解析 `ip -o -4 addr show` 输出
func parseIPAddr(out string) []Addr {
	var addrs []Addr
	for _, line := range strings.Split(out, "\n") {
		m := reIPAddr.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		iface := strings.TrimSuffix(m[1], ":")
		if i := strings.Index(iface, "@"); i > 0 {
			iface = iface[:i]
		}
		if skipIface(iface) {
			continue
		}
		ip := net.ParseIP(m[2])
		kind := classifyIP(ip)
		if kind == "" {
			continue
		}
		prefix, _ := strconv.Atoi(m[3])
		addrs = append(addrs, Addr{IP: m[2], Prefix: prefix, Iface: iface, Kind: kind, Source: SourceIface})
	}
	return addrs
}

// localAddrs 本机网卡地址
func localAddrs() []Addr {
	var addrs []Addr
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || skipIface(iface.Name) {
			continue
		}
		list, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range list {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			kind := classifyIP(ipn.IP)
			if kind == "" {
				continue
			}
			ones, _ := ipn.Mask.Size()
			addrs = append(addrs, Addr{IP: ipn.IP.To4().String(), Prefix: ones, Iface: iface.Name, Kind: kind, Source: SourceIface})
		}
	}
	return addrs
}

// addHostName 把 SSH HostName 并入地址表：已在网卡上的跳过；域名只取第一个可分类的 IPv4
func addHostName(addrs []Addr, ips []net.IP) []Addr {
	for _, ip := range ips {
		kind := classifyIP(ip)
		if kind == "" {
			continue
		}
		s := ip.To4().String()
		if hasIP(addrs, s) {
			return addrs
		}
		return append(addrs, Addr{IP: s, Kind: kind, Source: SourceHostName})
	}
	return addrs
}

// addEgress 出口公网 IP：与已有地址重复时不重复列出
func addEgress(addrs []Addr, egress string) []Addr {
	ip := net.ParseIP(strings.TrimSpace(egress))
	if ip == nil || classifyIP(ip) != KindWAN {
		return addrs
	}
	s := ip.To4().String()
	if hasIP(addrs, s) {
		return addrs
	}
	return append(addrs, Addr{IP: s, Kind: KindWAN, Source: SourceEgress})
}

func hasIP(addrs []Addr, ip string) bool {
	for _, a := range addrs {
		if a.IP == ip {
			return true
		}
	}
	return false
}

var reEgressIP = regexp.MustCompile(`(?:当前\s*IP|IP)\s*[：:]\s*(\d+\.\d+\.\d+\.\d+)`)

// parseEgress 解析 myip.ipip.net 正文（当前 IP：1.2.3.4  来自于：…）
func parseEgress(body string) string {
	if m := reEgressIP.FindStringSubmatch(body); m != nil {
		return m[1]
	}
	return ""
}

// sameSubnet 两个地址是否在同一网段（任一方网段已知即可判断）
func sameSubnet(a, b Addr) bool {
	ipA, ipB := net.ParseIP(a.IP), net.ParseIP(b.IP)
	if ipA == nil || ipB == nil {
		return false
	}
	for _, x := range []struct {
		n  Addr
		ip net.IP
	}{{a, ipB}, {b, ipA}} {
		if x.n.Prefix <= 0 || x.n.Prefix >= 32 {
			continue
		}
		if _, n, err := net.ParseCIDR(x.n.CIDR()); err == nil && n.Contains(x.ip) {
			return true
		}
	}
	return false
}
