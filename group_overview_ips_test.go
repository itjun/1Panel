package main

import (
	"testing"

	"diteng-pannel/internal/monitor"
)

func TestPickHostIPs(t *testing.T) {
	cases := []struct {
		name     string
		hostName string
		snap     monitor.NetworkSnapshot
		pub      string
		priv     string
	}{
		{
			name:     "SSH 地址为公网 IP",
			hostName: "198.51.100.136",
			snap:     monitor.NetworkSnapshot{PrivateIPs: []string{"192.168.0.10/24 (eth0)"}, EgressPublicIP: "1.1.1.1"},
			pub:      "198.51.100.136",
			priv:     "192.168.0.10",
		},
		{
			name:     "SSH 地址为内网 IP，取出口 IP",
			hostName: "10.0.0.5",
			snap:     monitor.NetworkSnapshot{PrivateIPs: []string{"10.0.0.5/24 (ens3)"}, EgressPublicIP: "8.8.4.4"},
			pub:      "8.8.4.4",
			priv:     "10.0.0.5",
		},
		{
			name:     "域名 + 网卡公网 IP",
			hostName: "example.com",
			snap:     monitor.NetworkSnapshot{PublicIPs: []string{"203.0.113.7/24 (eth0)"}},
			pub:      "203.0.113.7",
			priv:     "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pub, priv := pickHostIPs(tc.hostName, tc.snap)
			if pub != tc.pub || priv != tc.priv {
				t.Fatalf("got (%q, %q), want (%q, %q)", pub, priv, tc.pub, tc.priv)
			}
		})
	}
}
