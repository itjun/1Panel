package monitor

import (
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"
)

// NetworkSnapshot 目标主机网络全景
type NetworkSnapshot struct {
	Interfaces []NetInterface `json:"interfaces"`
	// 汇总 IP：内网 / 外网 / Docker 网桥
	PrivateIPs []string `json:"privateIPs"`
	PublicIPs  []string `json:"publicIPs"`
	DockerIPs  []string `json:"dockerIPs"`
	// 出口公网 IP（访问 myip.ipip.net 解析，可能为空）
	EgressPublicIP string `json:"egressPublicIP"`
	// 出口公网归属地（myip.ipip.net「来自于」字段，可能为空）
	EgressPublicLoc string `json:"egressPublicLoc"`
	// 默认路由网关
	DefaultGateway string `json:"defaultGateway"`
	// TCP 连接（含进程）
	Connections []NetConnection `json:"connections"`
	// 疑似网络响应卡顿的连接/进程（高亮用）
	SlowConnections []NetConnection `json:"slowConnections"`
	// 统计
	ConnTotal       int `json:"connTotal"`
	ConnEstablished int `json:"connEstablished"`
	ConnListen      int `json:"connListen"`
	ConnTimeWait    int `json:"connTimeWait"`
}

// NetInterface 网卡信息
type NetInterface struct {
	Name      string   `json:"name"`
	State     string   `json:"state"` // UP / DOWN
	MTU       int      `json:"mtu"`
	MAC       string   `json:"mac"`
	IPv4      []string `json:"ipv4"`
	Kind      string   `json:"kind"` // physical | docker | virtual | loopback | other
	RxBytes   uint64   `json:"rxBytes"`
	TxBytes   uint64   `json:"txBytes"`
	RxPackets uint64   `json:"rxPackets"`
	TxPackets uint64   `json:"txPackets"`
}

// NetConnection 一条 TCP 连接
type NetConnection struct {
	Proto      string  `json:"proto"`
	State      string  `json:"state"`
	LocalAddr  string  `json:"localAddr"`
	RemoteAddr string  `json:"remoteAddr"`
	RecvQ      uint64  `json:"recvQ"`
	SendQ      uint64  `json:"sendQ"`
	PID        uint32  `json:"pid"`
	Process    string  `json:"process"`
	Slow       bool    `json:"slow"`
	SlowReason string  `json:"slowReason,omitempty"`
	RTTMs      float64 `json:"rttMs,omitempty"`
}

const (
	slowQueueBytes uint64  = 8192
	slowRTTMs      float64 = 200
	// egressCacheTTL 出口 IP 探测成功后的缓存时长；egressRetryDelay 失败后的重试间隔
	egressCacheTTL   = 10 * time.Minute
	egressRetryDelay = time.Minute
)

var (
	reUsers   = regexp.MustCompile(`users:\(\("([^"]*)",pid=(\d+)`)
	reRTT     = regexp.MustCompile(`rtt:([0-9.]+)/`)
	reLinkMAC = regexp.MustCompile(`link/ether\s+([0-9a-fA-F:]+)`)
	reMTU     = regexp.MustCompile(`mtu\s+(\d+)`)
	reState   = regexp.MustCompile(`state\s+(\w+)`)
	// myip.ipip.net 正文示例：当前 IP：203.0.113.67  来自于：中国 示例 示例  示例运营商
	reIPIPIP  = regexp.MustCompile(`(?:当前\s*IP|IP)\s*[：:]\s*([0-9a-fA-F:.]+)`)
	reIPIPLoc = regexp.MustCompile(`来自于\s*[：:]\s*(.+)`)
	reIPv4Any = regexp.MustCompile(`\b((?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))\b`)
)

// CollectNetwork 采集网卡、IP 分类、连接与疑似卡顿连接。
// 本地信息（网卡/路由/连接）每次实时；出口公网 IP 段含外网请求（限时 3s），
// 单独成命令并缓存 10 分钟——网络页轮询不再每次都打外网。
func (c *Collector) CollectNetwork(host string, opt sshd.ConnectOption) (NetworkSnapshot, error) {
	script := `echo "=LINK="; ip -o link show 2>/dev/null; echo "=ADDR="; ip -o -4 addr show 2>/dev/null; echo "=ROUTE="; ip -4 route show default 2>/dev/null | head -n3; echo "=NETDEV="; cat /proc/net/dev 2>/dev/null; echo "=SS="; ss -Htanp 2>/dev/null | head -n 800; echo "=SSTI="; ss -Hti 2>/dev/null | head -n 400`
	out, err := c.mgr.Run(host, opt, script, sshd.RunOptions{Timeout: 15 * time.Second})
	if err != nil {
		return NetworkSnapshot{}, err
	}
	egress := c.egressCached(host, opt)
	return parseNetworkSnapshot(string(out) + "\n=EGRESS=\n" + egress), nil
}

// egressCached 出口 IP 探测（curl myip.ipip.net，含归属地）。
// 成功缓存 10 分钟；失败保留旧值不清空（外网探测易瞬时抖动，清空会让出口 IP
// 消失整个 TTL 周期），1 分钟后自动重试。
func (c *Collector) egressCached(host string, opt sshd.ConnectOption) string {
	c.egressMu.Lock()
	defer c.egressMu.Unlock()
	if time.Now().Before(c.egressNext) {
		return c.egressOut
	}
	out, _ := c.mgr.Run(host, opt,
		`curl -4 -sL --max-time 3 https://myip.ipip.net/ 2>/dev/null || wget -qO- --timeout=3 https://myip.ipip.net/ 2>/dev/null || true`,
		sshd.RunOptions{Timeout: 8 * time.Second})
	if strings.TrimSpace(string(out)) == "" {
		c.egressNext = time.Now().Add(egressRetryDelay)
	} else {
		c.egressOut, c.egressNext = string(out), time.Now().Add(egressCacheTTL)
	}
	return c.egressOut
}

func parseNetworkSnapshot(raw string) NetworkSnapshot {
	sec := splitSections(raw)
	ifaces := parseNetLinks(sec["LINK"], sec["ADDR"], sec["NETDEV"])
	priv, pub, dock := classifyIPs(ifaces)
	gw := parseDefaultGateway(sec["ROUTE"])
	conns, rttByKey := parseSSConnections(sec["SS"], sec["SSTI"])
	slow := make([]NetConnection, 0)
	var nEst, nListen, nTW int
	for i := range conns {
		st := strings.ToUpper(conns[i].State)
		switch {
		case strings.Contains(st, "ESTAB"):
			nEst++
		case strings.Contains(st, "LISTEN"):
			nListen++
		case strings.Contains(st, "TIME-WAIT") || strings.Contains(st, "TIMEWAIT"):
			nTW++
		}
		// 合并 RTT
		key := conns[i].LocalAddr + "|" + conns[i].RemoteAddr
		if rtt, ok := rttByKey[key]; ok && rtt > 0 {
			conns[i].RTTMs = rtt
		}
		// 卡顿判定
		var reasons []string
		if conns[i].RecvQ >= slowQueueBytes {
			reasons = append(reasons, "Recv-Q 积压")
		}
		if conns[i].SendQ >= slowQueueBytes {
			reasons = append(reasons, "Send-Q 积压")
		}
		if conns[i].RTTMs >= slowRTTMs {
			reasons = append(reasons, "RTT 偏高")
		}
		// 仅对 ESTABLISHED 高亮；LISTEN 的队列不算卡顿
		if len(reasons) > 0 && strings.Contains(st, "ESTAB") {
			conns[i].Slow = true
			conns[i].SlowReason = strings.Join(reasons, " · ")
			slow = append(slow, conns[i])
		}
	}

	egressIP, egressLoc := parseEgressFromIPIP(sec["EGRESS"])

	return NetworkSnapshot{
		Interfaces:      ifaces,
		PrivateIPs:      uniq(priv),
		PublicIPs:       uniq(pub),
		DockerIPs:       uniq(dock),
		EgressPublicIP:  egressIP,
		EgressPublicLoc: egressLoc,
		DefaultGateway:  gw,
		Connections:     conns,
		SlowConnections: slow,
		ConnTotal:       len(conns),
		ConnEstablished: nEst,
		ConnListen:      nListen,
		ConnTimeWait:    nTW,
	}
}

// parseEgressFromIPIP 解析 https://myip.ipip.net/ 返回正文
// 示例：当前 IP：203.0.113.67  来自于：中国 示例 示例  示例运营商
func parseEgressFromIPIP(raw string) (ip, loc string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	// 去掉 HTML 标签（若被 CDN/代理包过一层）
	if strings.Contains(raw, "<") {
		raw = stripSimpleTags(raw)
	}
	if m := reIPIPIP.FindStringSubmatch(raw); len(m) == 2 {
		cand := strings.TrimSpace(m[1])
		if net.ParseIP(cand) != nil {
			ip = cand
		}
	}
	if ip == "" {
		// 兜底：取正文中第一个合法 IPv4
		if m := reIPv4Any.FindStringSubmatch(raw); len(m) == 2 {
			if net.ParseIP(m[1]) != nil {
				ip = m[1]
			}
		}
	}
	if m := reIPIPLoc.FindStringSubmatch(raw); len(m) == 2 {
		loc = strings.Join(strings.Fields(strings.TrimSpace(m[1])), " ")
	}
	return ip, loc
}

func stripSimpleTags(s string) string {
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func parseNetLinks(linkSec, addrSec, netdevSec string) []NetInterface {
	// name -> iface
	m := map[string]*NetInterface{}

	for _, line := range strings.Split(linkSec, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 1: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ... state UP ... link/ether aa:bb...
		// ip -o link: "2: eth0: <...> mtu 1500 qdisc ... state UP mode ...\    link/ether ..."
		// 可能把 link/ether 放同一行
		parts := strings.SplitN(line, ":", 3)
		if len(parts) < 3 {
			continue
		}
		name := strings.TrimSpace(parts[1])
		if name == "" {
			continue
		}
		rest := parts[2]
		ni := &NetInterface{Name: name, Kind: ifaceKind(name), IPv4: []string{}}
		if reState.MatchString(rest) {
			ni.State = strings.ToUpper(reState.FindStringSubmatch(rest)[1])
		} else if strings.Contains(rest, "UP") {
			ni.State = "UP"
		} else {
			ni.State = "DOWN"
		}
		if reMTU.MatchString(rest) {
			ni.MTU, _ = strconv.Atoi(reMTU.FindStringSubmatch(rest)[1])
		}
		if reLinkMAC.MatchString(rest) {
			ni.MAC = reLinkMAC.FindStringSubmatch(rest)[1]
		}
		m[name] = ni
	}

	// IPv4
	for _, line := range strings.Split(addrSec, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 2: eth0    inet 192.168.1.1/24 brd ...
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		name := strings.TrimSuffix(fields[1], ":")
		// find inet + next
		for i := 0; i < len(fields)-1; i++ {
			if fields[i] == "inet" {
				ipCidr := fields[i+1]
				ip := strings.Split(ipCidr, "/")[0]
				if ni, ok := m[name]; ok {
					ni.IPv4 = append(ni.IPv4, ipCidr)
				} else {
					m[name] = &NetInterface{
						Name:  name,
						Kind:  ifaceKind(name),
						IPv4:  []string{ipCidr},
						State: "UP",
					}
				}
				_ = ip
				break
			}
		}
	}

	// traffic from /proc/net/dev
	for _, line := range strings.Split(netdevSec, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "Inter-") || strings.HasPrefix(line, "face") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		fields := strings.Fields(parts[1])
		if len(fields) < 10 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		rxp, _ := strconv.ParseUint(fields[1], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		txp, _ := strconv.ParseUint(fields[9], 10, 64)
		if ni, ok := m[name]; ok {
			ni.RxBytes, ni.TxBytes = rx, tx
			ni.RxPackets, ni.TxPackets = rxp, txp
		}
	}

	out := make([]NetInterface, 0, len(m))
	for _, ni := range m {
		// 跳过纯 veth 可选项：仍展示但 kind=virtual
		out = append(out, *ni)
	}
	// 排序：docker / physical 优先，loopback 靠后
	sortIfaces(out)
	return out
}

func sortIfaces(list []NetInterface) {
	order := map[string]int{"physical": 0, "docker": 1, "virtual": 2, "other": 3, "loopback": 4}
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			ai, aj := order[list[i].Kind], order[list[j].Kind]
			if aj < ai || (aj == ai && list[j].Name < list[i].Name) {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
}

func ifaceKind(name string) string {
	n := strings.ToLower(name)
	switch {
	case n == "lo":
		return "loopback"
	case n == "docker0", strings.HasPrefix(n, "br-"), strings.HasPrefix(n, "veth"),
		strings.HasPrefix(n, "docker"), strings.HasPrefix(n, "cni"), strings.HasPrefix(n, "flannel"),
		strings.HasPrefix(n, "cbr"), strings.HasPrefix(n, "weave"), strings.HasPrefix(n, "cali"):
		return "docker"
	case strings.HasPrefix(n, "eth"), strings.HasPrefix(n, "ens"), strings.HasPrefix(n, "enp"),
		strings.HasPrefix(n, "eno"), strings.HasPrefix(n, "em"), strings.HasPrefix(n, "bond"),
		strings.HasPrefix(n, "wlan"), strings.HasPrefix(n, "wlp"):
		return "physical"
	case strings.HasPrefix(n, "virbr"), strings.HasPrefix(n, "tun"), strings.HasPrefix(n, "tap"),
		strings.HasPrefix(n, "wg"), strings.HasPrefix(n, "utun"):
		return "virtual"
	default:
		return "other"
	}
}

func classifyIPs(ifaces []NetInterface) (priv, pub, dock []string) {
	for _, ni := range ifaces {
		for _, cidr := range ni.IPv4 {
			ipStr := strings.Split(cidr, "/")[0]
			ip := net.ParseIP(ipStr)
			if ip == nil || ip.To4() == nil {
				continue
			}
			if ni.Kind == "docker" || isDockerBridgeIP(ip) {
				dock = append(dock, cidr+" ("+ni.Name+")")
				continue
			}
			if ip.IsLoopback() {
				continue
			}
			if ip.IsPrivate() || ip.IsLinkLocalUnicast() {
				priv = append(priv, cidr+" ("+ni.Name+")")
			} else {
				pub = append(pub, cidr+" ("+ni.Name+")")
			}
		}
	}
	return
}

// Docker 默认网桥 172.17.0.0/16 及常见容器网段
func isDockerBridgeIP(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	// 172.16.0.0 – 172.31.0.0 中 172.17/18 常见 docker
	if ip4[0] == 172 && (ip4[1] == 17 || ip4[1] == 18) {
		return true
	}
	return false
}

func parseDefaultGateway(routeSec string) string {
	// default via 192.168.1.1 dev eth0 ...
	for _, line := range strings.Split(routeSec, "\n") {
		fields := strings.Fields(line)
		for i := 0; i < len(fields)-1; i++ {
			if fields[i] == "via" {
				return fields[i+1]
			}
		}
	}
	return ""
}

// parseSSConnections 解析 ss -tanp；RTT 从 ss -ti 尽量匹配
func parseSSConnections(ssSec, sstiSec string) ([]NetConnection, map[string]float64) {
	rttMap := parseSSRTT(sstiSec)
	out := make([]NetConnection, 0, 64)
	for _, line := range strings.Split(ssSec, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// tcp ESTAB 0 0 1.2.3.4:22 5.6.7.8:12345 users:(("sshd",pid=1,fd=3))
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		// Netid may be missing with -H; formats vary:
		// With -t: State Recv-Q Send-Q Local Peer Process
		// With -tanp sometimes: tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(...)
		var proto, state, local, remote string
		var recvQ, sendQ uint64
		var restStart int

		if fields[0] == "tcp" || fields[0] == "udp" || fields[0] == "tcp6" || fields[0] == "udp6" {
			proto = fields[0]
			if len(fields) < 6 {
				continue
			}
			state = fields[1]
			recvQ, _ = strconv.ParseUint(fields[2], 10, 64)
			sendQ, _ = strconv.ParseUint(fields[3], 10, 64)
			local, remote = fields[4], fields[5]
			restStart = 6
		} else {
			// State Recv-Q Send-Q Local Peer ...
			proto = "tcp"
			state = fields[0]
			recvQ, _ = strconv.ParseUint(fields[1], 10, 64)
			sendQ, _ = strconv.ParseUint(fields[2], 10, 64)
			if len(fields) < 5 {
				continue
			}
			local, remote = fields[3], fields[4]
			restStart = 5
		}

		procName := ""
		var pid uint32
		rest := strings.Join(fields[restStart:], " ")
		if m := reUsers.FindStringSubmatch(rest); len(m) == 3 {
			procName = m[1]
			p, _ := strconv.ParseUint(m[2], 10, 32)
			pid = uint32(p)
		}

		c := NetConnection{
			Proto:      proto,
			State:      state,
			LocalAddr:  local,
			RemoteAddr: remote,
			RecvQ:      recvQ,
			SendQ:      sendQ,
			PID:        pid,
			Process:    procName,
		}
		out = append(out, c)
	}
	return out, rttMap
}

// parseSSRTT 粗解析 ss -ti：连接行后的 rtt:xx.x/yy.y
func parseSSRTT(ssti string) map[string]float64 {
	m := map[string]float64{}
	lines := strings.Split(ssti, "\n")
	var lastLocal, lastRemote string
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" {
			continue
		}
		fields := strings.Fields(trim)
		// 连接行：含 ESTAB 与地址
		if len(fields) >= 5 && (fields[0] == "tcp" || strings.Contains(fields[0], "ESTAB") || fields[0] == "ESTAB") {
			// try extract local peer
			if fields[0] == "tcp" && len(fields) >= 6 {
				lastLocal, lastRemote = fields[4], fields[5]
			} else if len(fields) >= 5 {
				// ESTAB 0 0 local peer
				lastLocal, lastRemote = fields[3], fields[4]
			}
			continue
		}
		if lastLocal == "" {
			continue
		}
		if rtt := reRTT.FindStringSubmatch(trim); len(rtt) == 2 {
			v, err := strconv.ParseFloat(rtt[1], 64)
			if err == nil {
				m[lastLocal+"|"+lastRemote] = v
			}
		}
	}
	return m
}

func uniq(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}
