package speedtest

import (
	"net"
	"testing"
)

const debianIPAddr = `1: lo    inet 127.0.0.1/8 scope host lo\       valid_lft forever preferred_lft forever
2: enp2s0    inet 192.168.60.6/24 brd 192.168.60.255 scope global dynamic enp2s0\       valid_lft 80000sec
3: tailscale0    inet 100.64.12.95/32 scope global tailscale0
4: br-efa625ab6e48    inet 172.18.0.1/16 brd 172.18.255.255 scope global br-efa625ab6e48
5: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0
6: eth0.10@eth0    inet 10.0.10.2/24 scope global eth0.10`

func TestParseIPAddrSkipsContainersAndLoopback(t *testing.T) {
	addrs := parseIPAddr(debianIPAddr)
	if len(addrs) != 3 {
		t.Fatalf("want 3 addrs, got %+v", addrs)
	}
	if addrs[0].CIDR() != "192.168.60.6/24" || addrs[0].Kind != KindLAN || addrs[0].Iface != "enp2s0" {
		t.Fatalf("unexpected first addr %+v", addrs[0])
	}
	if addrs[1].Kind != KindOverlay {
		t.Fatalf("tailscale should be overlay: %+v", addrs[1])
	}
	if addrs[2].Iface != "eth0.10" {
		t.Fatalf("vlan iface name should drop @parent: %+v", addrs[2])
	}
}

func TestClassifyIP(t *testing.T) {
	cases := map[string]string{
		"192.168.1.1":   KindLAN,
		"10.2.3.4":      KindLAN,
		"172.20.0.1":    KindLAN,
		"100.100.1.1":   KindOverlay,
		"8.8.8.8":       KindWAN,
		"198.18.0.1":    "",
		"127.0.0.1":     "",
		"169.254.10.10": "",
	}
	for ip, want := range cases {
		if got := classifyIP(net.ParseIP(ip)); got != want {
			t.Errorf("%s: want %q got %q", ip, want, got)
		}
	}
}

func view(id string, local bool, addrs ...Addr) EndpointView {
	return EndpointView{ID: id, Label: id, Local: local, Addrs: addrs, Segments: Segments(addrs)}
}

func lan(cidrIP string, prefix int) Addr {
	return Addr{IP: cidrIP, Prefix: prefix, Kind: KindLAN, Source: SourceIface}
}

func TestLocalToDebianSameSubnet(t *testing.T) {
	local := view("本机", true, lan("192.168.60.5", 24), Addr{IP: "100.64.238.76", Prefix: 32, Kind: KindOverlay, Source: SourceIface})
	debian := view("debian", false, parseIPAddr(debianIPAddr)...)
	debian.Addrs = addEgress(debian.Addrs, "203.0.113.67")
	cands := BuildCandidates(local, debian)
	if len(cands) == 0 || cands[0].Relation != RelSame || cands[0].Target.IP != "192.168.60.6" || cands[0].Server != SideB {
		t.Fatalf("first candidate should be same-subnet 192.168.60.6 on B: %+v", cands)
	}
	var overlay, nat bool
	for _, c := range cands {
		if c.Relation == RelOverlay && c.Target.IP == "100.64.12.95" {
			overlay = true
		}
		if c.Relation == RelNAT && c.Kind == KindWAN {
			nat = true
		}
		if c.Target.IP == "10.0.10.2" && c.Relation != RelRouted {
			t.Fatalf("10.0.10.2 should be routed: %+v", c)
		}
	}
	if !overlay || !nat {
		t.Fatalf("want overlay and nat candidates: %+v", cands)
	}
}

func TestLocalAsBAlwaysClient(t *testing.T) {
	local := view("本机", true, lan("192.168.60.5", 24))
	debian := view("debian", false, lan("192.168.60.6", 24))
	cands := BuildCandidates(debian, local)
	if len(cands) != 1 || cands[0].Server != SideA {
		t.Fatalf("server must be the remote side A: %+v", cands)
	}
}

func TestWANFallsBackToOtherSide(t *testing.T) {
	a := view("cloud", false, lan("172.16.0.5", 20), Addr{IP: "47.1.2.3", Kind: KindWAN, Source: SourceHostName})
	b := view("home", false, lan("192.168.1.9", 24))
	cands := BuildCandidates(a, b)
	var found bool
	for _, c := range cands {
		if c.Kind == KindWAN && c.Server == SideA && c.Target.IP == "47.1.2.3" {
			found = true
		}
	}
	if !found {
		t.Fatalf("B has no public addr, A should become WAN server: %+v", cands)
	}
}

func TestDecide(t *testing.T) {
	a := view("a", false, lan("10.0.0.1", 24))
	b := view("b", false, lan("10.0.0.2", 24), Addr{IP: "1.2.3.4", Kind: KindWAN, Source: SourceIface})

	r := PathReport{A: a, B: b, Candidates: BuildCandidates(a, b)}
	for i := range r.Candidates {
		r.Candidates[i].Probed, r.Candidates[i].OK = true, true
	}
	Decide(&r)
	if r.Decision != DecideChoose || r.LAN.Best.Target.IP != "10.0.0.2" || r.WAN.Best.Target.IP != "1.2.3.4" {
		t.Fatalf("both ok should choose: %+v", r)
	}

	r = PathReport{A: a, B: b, Candidates: BuildCandidates(a, b)}
	for i := range r.Candidates {
		r.Candidates[i].Probed = true
		r.Candidates[i].OK = r.Candidates[i].Kind == KindWAN
		if !r.Candidates[i].OK {
			r.Candidates[i].Reason = "连接超时"
		}
	}
	Decide(&r)
	if r.Decision != DecideWAN || r.LAN.Available || r.LAN.Reason != "连接超时" {
		t.Fatalf("only wan: %+v", r)
	}

	x := view("x", false, lan("10.1.0.1", 24))
	y := view("y", false, lan("192.168.9.1", 24))
	r = PathReport{A: x, B: y, Candidates: BuildCandidates(x, y)}
	for i := range r.Candidates {
		r.Candidates[i].Probed, r.Candidates[i].Reason = true, "连接超时"
	}
	Decide(&r)
	if r.Decision != DecideNone || r.Message == "" || r.WAN.Reason == "" {
		t.Fatalf("none: %+v", r)
	}
}

func TestParseEgress(t *testing.T) {
	if got := parseEgress("当前 IP：203.0.113.67  来自于：中国 示例 示例  示例运营商"); got != "203.0.113.67" {
		t.Fatal(got)
	}
}
