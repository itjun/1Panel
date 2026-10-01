package main

import (
	"context"
	"net"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/monitor"
)

const (
	// hostIPCacheTTL 网卡地址极少变化；/collect/network 偏重（含连接表），分组页 5s 轮询不能每次都打
	hostIPCacheTTL   = 10 * time.Minute
	hostIPRetryDelay = time.Minute
)

type hostIPEntry struct {
	hostName  string
	publicIP  string
	privateIP string
	next      time.Time
	loading   bool
}

var hostIPCache = struct {
	sync.Mutex
	m map[string]*hostIPEntry
}{m: map[string]*hostIPEntry{}}

// cachedHostIPs 返回主机外网/内网 IP；缓存缺失或过期时后台异步刷新，本次先返回旧值（首次为空）
func cachedHostIPs(host, hostName string, cli *agentcli.Client) (publicIP, privateIP string) {
	hostIPCache.Lock()
	defer hostIPCache.Unlock()
	e := hostIPCache.m[host]
	if e == nil || e.hostName != hostName {
		e = &hostIPEntry{hostName: hostName}
		hostIPCache.m[host] = e
	}
	if !e.loading && time.Now().After(e.next) {
		e.loading = true
		go refreshHostIPs(host, hostName, cli)
	}
	if e.publicIP == "" && e.privateIP == "" {
		return publicHostName(hostName), ""
	}
	return e.publicIP, e.privateIP
}

func refreshHostIPs(host, hostName string, cli *agentcli.Client) {
	var snap monitor.NetworkSnapshot
	err := cli.GetJSON(context.Background(), "/collect/network", &snap, true)

	hostIPCache.Lock()
	defer hostIPCache.Unlock()
	e := hostIPCache.m[host]
	if e == nil || e.hostName != hostName {
		return
	}
	e.loading = false
	if err != nil {
		e.next = time.Now().Add(hostIPRetryDelay)
		return
	}
	e.publicIP, e.privateIP = pickHostIPs(hostName, snap)
	e.next = time.Now().Add(hostIPCacheTTL)
}

// pickHostIPs SSH 地址本身是公网 IP 时优先用它（云主机网卡上通常只有私网地址）
func pickHostIPs(hostName string, snap monitor.NetworkSnapshot) (publicIP, privateIP string) {
	publicIP = publicHostName(hostName)
	if publicIP == "" && len(snap.PublicIPs) > 0 {
		publicIP = bareIP(snap.PublicIPs[0])
	}
	if publicIP == "" {
		publicIP = strings.TrimSpace(snap.EgressPublicIP)
	}
	if len(snap.PrivateIPs) > 0 {
		privateIP = bareIP(snap.PrivateIPs[0])
	}
	return publicIP, privateIP
}

func publicHostName(hostName string) string {
	ip := net.ParseIP(strings.TrimSpace(hostName))
	if ip == nil || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return ""
	}
	return ip.String()
}

// bareIP 把 "10.0.0.5/24 (eth0)" 还原成 "10.0.0.5"
func bareIP(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "/ "); i >= 0 {
		s = s[:i]
	}
	return s
}
