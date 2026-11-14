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

func dialTCPOnce(addr string) (net.Conn, error) {
	// 交给系统路由选择源地址，与 OpenSSH 保持一致。
	// 按网段强绑本机地址会绕过更具体的 VPN 路由，多网卡时可能因此连不上。
	d := net.Dialer{Timeout: tcpConnectTimeout}
	return d.Dial("tcp", addr)
}
