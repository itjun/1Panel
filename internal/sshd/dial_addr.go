package sshd

import (
	"fmt"
	"net"
	"strings"
)

func isNoRoute(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "no route to host") || strings.Contains(s, "host is down")
}

func wrapDialErr(addr string, err error) error {
	if err == nil {
		return nil
	}
	if isNoRoute(err) {
		return fmt.Errorf("连接 %s 失败: %w（若目标在局域网：系统设置 → 隐私与安全性 → 本地网络 → 打开 1Panel）", addr, err)
	}
	return fmt.Errorf("连接 %s 失败: %w", addr, err)
}

// localTCPAddr 目标落在某块网卡的网段内时，绑定该网卡地址，避免走默认路由（VPN/TUN）。
func localTCPAddr(dst net.IP) *net.TCPAddr {
	if dst == nil {
		return nil
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 {
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
			if ipn.Contains(dst) {
				ip := ipn.IP
				if dst.To4() != nil {
					ip = ip.To4()
				}
				if ip == nil {
					continue
				}
				return &net.TCPAddr{IP: ip}
			}
		}
	}
	return nil
}

func dialTCPOnce(addr string) (net.Conn, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	d := net.Dialer{Timeout: tcpConnectTimeout}
	if ip := net.ParseIP(host); ip != nil {
		if local := localTCPAddr(ip); local != nil {
			d.LocalAddr = local
		}
	}
	return d.Dial("tcp", addr)
}
