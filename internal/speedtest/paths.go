package speedtest

import (
	"sort"
	"strings"
)

// 候选路径与对端的关系
const (
	RelSame    = "same"    // 同网段私网
	RelRouted  = "routed"  // 不同网段的私网（VPC 跨子网、VPN 路由等），需实测
	RelOverlay = "overlay" // Tailscale 等虚拟内网
	RelPublic  = "public"  // 网卡上的公网 IP 或公网 HostName
	RelNAT     = "nat"     // 出口公网 IP，可能经过 NAT，通常需要端口映射
)

// 决策结果
const (
	DecideLAN    = "lan"    // 只有局域网可用，自动选局域网
	DecideWAN    = "wan"    // 只有广域网可用，自动选广域网
	DecideChoose = "choose" // 两者都可用，由用户选（默认局域网）
	DecideNone   = "none"   // 都不可用
)

// Side 端点一侧
const (
	SideA = "a"
	SideB = "b"
)

// Candidate 一条候选路径：客户端连接服务端（Server 侧）的 Target 地址
type Candidate struct {
	Kind       string  `json:"kind"`     // lan / wan
	Relation   string  `json:"relation"` // same / routed / overlay / public / nat
	Server     string  `json:"server"`   // 服务端在哪一侧：a / b
	Target     Addr    `json:"target"`
	ClientAddr *Addr   `json:"clientAddr,omitempty"` // 同网段时客户端侧的对应地址
	Port       int     `json:"port,omitempty"` // 探测时服务端监听的端口
	Probed     bool    `json:"probed"`
	OK         bool    `json:"ok"`
	RTTMs      float64 `json:"rttMs"`
	Reason     string  `json:"reason,omitempty"`
}

// EndpointView 一侧端点的地址视图
type EndpointView struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Local    bool     `json:"local"`
	Addrs    []Addr   `json:"addrs"`
	Segments []string `json:"segments"` // 展示用：网段或单地址
	Error    string   `json:"error,omitempty"`
}

// PathSummary 一类路径（局域网或广域网）的汇总，对应前端一张卡片
type PathSummary struct {
	Available bool       `json:"available"`
	Best      *Candidate `json:"best,omitempty"`
	Reason    string     `json:"reason,omitempty"`
}

// PathReport DetectPaths 的返回
type PathReport struct {
	A          EndpointView `json:"a"`
	B          EndpointView `json:"b"`
	Port       int          `json:"port"`
	Candidates []Candidate  `json:"candidates"`
	LAN        PathSummary  `json:"lan"`
	WAN        PathSummary  `json:"wan"`
	Decision   string       `json:"decision"`
	Message    string       `json:"message"`
}

// primaryServer 本机通常在 NAT 后，固定当客户端；否则 B 当服务端
func primaryServer(aLocal, bLocal bool) string {
	if bLocal {
		return SideA
	}
	return SideB
}

func other(side string) string {
	if side == SideA {
		return SideB
	}
	return SideA
}

var relOrder = map[string]int{RelSame: 0, RelRouted: 1, RelOverlay: 2, RelPublic: 3, RelNAT: 4}

// BuildCandidates 生成候选路径（尚未探测）
func BuildCandidates(a, b EndpointView) []Candidate {
	views := map[string]EndpointView{SideA: a, SideB: b}
	primary := primaryServer(a.Local, b.Local)
	var out []Candidate
	seen := map[string]bool{}
	add := func(c Candidate) {
		key := c.Server + "|" + c.Target.IP
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, c)
	}

	lanFor := func(server string) {
		srv, cli := views[server], views[other(server)]
		for _, t := range srv.Addrs {
			if t.Kind != KindLAN && t.Kind != KindOverlay {
				continue
			}
			c := Candidate{Kind: KindLAN, Server: server, Target: t}
			for i := range cli.Addrs {
				if cli.Addrs[i].Kind == t.Kind && sameSubnet(cli.Addrs[i], t) {
					ca := cli.Addrs[i]
					c.ClientAddr = &ca
					c.Relation = RelSame
					break
				}
			}
			if c.Relation == "" {
				switch {
				case t.Kind == KindOverlay && hasKind(cli.Addrs, KindOverlay):
					c.Relation = RelOverlay
				case t.Kind == KindLAN && hasKind(cli.Addrs, KindLAN):
					c.Relation = RelRouted
				default:
					continue
				}
			}
			add(c)
		}
	}
	wanFor := func(server string) int {
		n := 0
		for _, t := range views[server].Addrs {
			if t.Kind != KindWAN {
				continue
			}
			rel := RelPublic
			if t.Source == SourceEgress {
				rel = RelNAT
			} else {
				n++
			}
			add(Candidate{Kind: KindWAN, Relation: rel, Server: server, Target: t})
		}
		return n
	}

	lanFor(primary)
	confident := wanFor(primary)
	// 主服务端没有确定的公网地址、而另一侧不是本机时，反过来让另一侧当服务端
	if confident == 0 && !views[other(primary)].Local {
		wanFor(other(primary))
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind == KindLAN
		}
		return relOrder[out[i].Relation] < relOrder[out[j].Relation]
	})
	return out
}

func hasRelation(cands []Candidate, rel string) bool {
	for _, c := range cands {
		if c.Relation == rel {
			return true
		}
	}
	return false
}

func hasKind(addrs []Addr, kind string) bool {
	for _, a := range addrs {
		if a.Kind == kind {
			return true
		}
	}
	return false
}

// Segments 展示用网段列表：有网段写网段，否则写单地址
func Segments(addrs []Addr) []string {
	var out []string
	seen := map[string]bool{}
	for _, a := range addrs {
		s := a.Network()
		if s == "" {
			s = a.IP
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// Decide 按探测结果汇总两张卡片并给出决策
func Decide(r *PathReport) {
	r.LAN = summarize(r.Candidates, KindLAN)
	r.WAN = summarize(r.Candidates, KindWAN)
	if !r.LAN.Available && r.LAN.Reason == "" {
		r.LAN.Reason = "两端没有共同网段：" + segmentsText(r.A, r.B)
	}
	if !r.WAN.Available && r.WAN.Reason == "" {
		r.WAN.Reason = "服务端没有公网地址（网卡上没有公网 IP，SSH HostName 也不是公网地址）"
	}
	switch {
	case r.LAN.Available && r.WAN.Available:
		r.Decision, r.Message = DecideChoose, "局域网和广域网都可用，请选择测速路径（默认局域网）"
	case r.LAN.Available:
		r.Decision, r.Message = DecideLAN, "已自动选择局域网"
	case r.WAN.Available:
		r.Decision, r.Message = DecideWAN, "局域网不可达，已自动选择广域网"
	default:
		r.Decision = DecideNone
		if hasRelation(r.Candidates, RelSame) {
			r.Message = "两台主机在同一网段，但局域网和广域网都连不通：" + r.LAN.Reason
		} else {
			r.Message = "两台主机不在同一网段，公网也不可达。" + segmentsText(r.A, r.B)
		}
	}
}

func summarize(cands []Candidate, kind string) PathSummary {
	var s PathSummary
	var firstFail *Candidate
	for i := range cands {
		c := &cands[i]
		if c.Kind != kind {
			continue
		}
		if c.OK {
			if s.Best == nil || betterThan(c, s.Best) {
				s.Best = c
			}
			continue
		}
		if firstFail == nil {
			firstFail = c
		}
	}
	if s.Best != nil {
		s.Available = true
		return s
	}
	if firstFail != nil {
		s.Best = firstFail
		s.Reason = firstFail.Reason
	}
	return s
}

// betterThan 关系优先（同网段 > 跨网段 > 虚拟内网；公网 > NAT），同关系比 RTT
func betterThan(x, y *Candidate) bool {
	if relOrder[x.Relation] != relOrder[y.Relation] {
		return relOrder[x.Relation] < relOrder[y.Relation]
	}
	if x.RTTMs > 0 && y.RTTMs > 0 {
		return x.RTTMs < y.RTTMs
	}
	return false
}

func segmentsText(a, b EndpointView) string {
	seg := func(v EndpointView) string {
		if len(v.Segments) == 0 {
			return "无可用地址"
		}
		return strings.Join(v.Segments, "、")
	}
	return a.Label + " 网段：" + seg(a) + "；" + b.Label + " 网段：" + seg(b)
}
