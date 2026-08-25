//go:build darwin

package sshd

import (
	"crypto/rand"
	"net"
	"time"
)

// TriggerLocalNetworkPrivacy 按 TN3179：对链路本地 IPv6 做 UDP connect（不发包），
// 并读一次主机名，用来弹出「本地网络」授权。
func TriggerLocalNetworkPrivacy() {
	triggerProcessHostName()
	ifaces, err := net.Interfaces()
	if err != nil {
		return
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagBroadcast == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok || ipn.IP == nil {
				continue
			}
			ip := ipn.IP.To16()
			if ip == nil || !ip.IsLinkLocalUnicast() {
				continue
			}
			for n := 0; n < 2; n++ {
				host := make([]byte, 8)
				_, _ = rand.Read(host)
				dst := make(net.IP, 16)
				copy(dst, ip)
				copy(dst[8:], host)
				c, err := net.DialUDP("udp6", nil, &net.UDPAddr{IP: dst, Port: 9, Zone: iface.Name})
				if err == nil {
					_ = c.Close()
				}
			}
		}
	}
}

func shouldRetryLAN(addr string, err error) bool {
	if !isNoRoute(err) {
		return false
	}
	host, _, splitErr := net.SplitHostPort(addr)
	if splitErr != nil {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.IsLoopback() {
		return false
	}
	return ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func retryDialTCP(addr string) (net.Conn, error) {
	var last error
	for i := 0; i < 4; i++ {
		time.Sleep(2 * time.Second)
		c, err := dialTCPOnce(addr)
		if err == nil {
			return c, nil
		}
		last = err
		if !isNoRoute(err) {
			return nil, err
		}
		TriggerLocalNetworkPrivacy()
	}
	return nil, last
}
