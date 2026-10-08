package speedtest

import "testing"

func TestParseSysSpeeds(t *testing.T) {
	out := "=SPEED=\nenp2s0 2500\nwlan0 0\nlo -1\nvmbr0 1000\ntailscale0 4294967295\nbad x\n"
	m := parseSysSpeeds(out)
	if m["enp2s0"] != 2500 || m["vmbr0"] != 1000 {
		t.Fatalf("unexpected speeds %+v", m)
	}
	for _, n := range []string{"wlan0", "lo", "tailscale0", "bad"} {
		if _, ok := m[n]; ok {
			t.Errorf("%s should be unknown: %+v", n, m)
		}
	}
}

func TestParseIfconfigSpeeds(t *testing.T) {
	out := `en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	ether aa:bb:cc:dd:ee:ff
	inet 192.168.50.87 netmask 0xffffff00 broadcast 192.168.50.255
	media: autoselect (2500Base-T <full-duplex>)
	status: active
en1: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	media: autoselect
	status: active
en5: flags=8863<UP> mtu 1500
	media: autoselect (1000baseT <full-duplex,flow-control>)
en8: flags=8863<UP> mtu 1500
	media: autoselect (10Gbase-T <full-duplex>)
`
	m := parseIfconfigSpeeds(out)
	if m["en0"] != 2500 || m["en5"] != 1000 || m["en8"] != 10000 {
		t.Fatalf("unexpected speeds %+v", m)
	}
	if _, ok := m["en1"]; ok {
		t.Fatalf("wifi should be unknown: %+v", m)
	}
}

func TestParseWinSpeeds(t *testing.T) {
	m := parseWinSpeeds("以太网|2500000000\r\nWLAN|866700000\r\nvEthernet (WSL)|10000000000\r\n")
	if m["以太网"] != 2500 || m["WLAN"] != 866 || m["vEthernet (WSL)"] != 10000 {
		t.Fatalf("unexpected speeds %+v", m)
	}
}

func TestBuildCandidatesLinkMbps(t *testing.T) {
	a := view("a", true, Addr{IP: "192.168.50.87", Prefix: 24, Iface: "en0", Kind: KindLAN, Source: SourceIface, SpeedMbps: 1000})
	b := view("b", false,
		Addr{IP: "192.168.50.222", Prefix: 24, Iface: "enp2s0", Kind: KindLAN, Source: SourceIface, SpeedMbps: 2500},
		Addr{IP: "10.0.0.5", Prefix: 24, Iface: "eth1", Kind: KindLAN, Source: SourceIface, SpeedMbps: 10000},
	)
	got := map[string]int{}
	for _, c := range BuildCandidates(a, b) {
		got[c.Target.IP] = c.LinkMbps
	}
	if got["192.168.50.222"] != 1000 {
		t.Errorf("same subnet should take min: %+v", got)
	}
	if got["10.0.0.5"] != 10000 {
		t.Errorf("routed should fall back to server side: %+v", got)
	}
}
