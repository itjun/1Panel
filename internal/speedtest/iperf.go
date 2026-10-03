package speedtest

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// 方向（相对用户选的 A、B）
const (
	DirForward = "forward" // A→B
	DirReverse = "reverse" // B→A
	DirBidir   = "bidir"   // 双向同时
)

// Params 测速参数
type Params struct {
	Protocol         string  `json:"protocol"`         // tcp / udp
	Parallel         int     `json:"parallel"`         // -P 1–64
	Duration         int     `json:"duration"`         // -t 3–300 秒
	Direction        string  `json:"direction"`        // forward / reverse / bidir
	UDPBandwidthMbps float64 `json:"udpBandwidthMbps"` // UDP 总目标带宽，0 表示不限
	Port             int     `json:"port"`             // 0 表示 5201–5210 自动
	Omit             int     `json:"omit"`             // -O 忽略开头秒数
	WindowKB         int     `json:"windowKB"`         // -w，0 表示系统默认
	MSS              int     `json:"mss"`              // -M，0 表示系统默认
	Congestion       string  `json:"congestion"`       // -C，仅 Linux 客户端
	Interval         float64 `json:"interval"`         // -i 0.5 / 1
}

// Normalize 夹紧到合法范围并补默认值
func (p *Params) Normalize() {
	p.Protocol = strings.ToLower(strings.TrimSpace(p.Protocol))
	if p.Protocol != "udp" {
		p.Protocol = "tcp"
	}
	p.Parallel = clampInt(p.Parallel, 1, 64, 4)
	p.Duration = clampInt(p.Duration, 3, 300, 10)
	switch p.Direction {
	case DirForward, DirReverse, DirBidir:
	default:
		p.Direction = DirForward
	}
	if p.UDPBandwidthMbps < 0 {
		p.UDPBandwidthMbps = 0
	}
	if p.Port != 0 && (p.Port < 1024 || p.Port > 65535) {
		p.Port = 0
	}
	if p.Omit < 0 || p.Omit > 10 {
		p.Omit = 0
	}
	if p.WindowKB < 0 {
		p.WindowKB = 0
	}
	if p.MSS < 0 || p.MSS > 9000 {
		p.MSS = 0
	}
	switch p.Congestion {
	case "", "cubic", "bbr", "reno":
	default:
		p.Congestion = ""
	}
	if p.Interval != 0.5 {
		p.Interval = 1
	}
}

func clampInt(v, lo, hi, def int) int {
	if v == 0 {
		return def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// flow 本次 iperf3 调用的方向映射：客户端在 A 侧还是 B 侧，以及是否带 -R / --bidir
type flow struct {
	clientIsA bool
	reverse   bool // -R：服务端发、客户端收
	bidir     bool
}

func newFlow(serverSide, direction string) flow {
	f := flow{clientIsA: serverSide == SideB}
	switch direction {
	case DirBidir:
		f.bidir = true
	case DirReverse:
		f.reverse = f.clientIsA
	default:
		f.reverse = !f.clientIsA
	}
	return f
}

// c2sIsAB 客户端→服务端方向是否就是 A→B
func (f flow) c2sIsAB() bool { return f.clientIsA }

// clientArgs 组装客户端参数（不含二进制路径）
func clientArgs(target string, port int, p Params, f flow, linuxClient bool) []string {
	args := []string{
		"-c", target, "-p", strconv.Itoa(port),
		"-t", strconv.Itoa(p.Duration),
		"-P", strconv.Itoa(p.Parallel),
		"-i", strconv.FormatFloat(p.Interval, 'f', -1, 64),
		"--connect-timeout", "3000",
		"--json-stream", "--forceflush",
	}
	if p.Omit > 0 {
		args = append(args, "-O", strconv.Itoa(p.Omit))
	}
	if p.Protocol == "udp" {
		// iperf3 的 -b 按单条流计，这里把总带宽均分到每条流
		bw := "0"
		if p.UDPBandwidthMbps > 0 {
			per := p.UDPBandwidthMbps * 1e6 / float64(p.Parallel)
			bw = strconv.FormatInt(int64(per), 10)
		}
		args = append(args, "-u", "-b", bw)
	}
	if f.bidir {
		args = append(args, "--bidir")
	} else if f.reverse {
		args = append(args, "-R")
	}
	if p.WindowKB > 0 {
		args = append(args, "-w", strconv.Itoa(p.WindowKB)+"K")
	}
	if p.MSS > 0 && p.Protocol == "tcp" {
		args = append(args, "-M", strconv.Itoa(p.MSS))
	}
	if p.Congestion != "" && p.Protocol == "tcp" && linuxClient {
		args = append(args, "-C", p.Congestion)
	}
	return args
}

// Sample 一个采样点；吞吐单位 bit/s，方向相对 A、B
type Sample struct {
	T           float64   `json:"t"`
	AB          float64   `json:"ab"`
	BA          float64   `json:"ba"`
	Retransmits int       `json:"retransmits"`
	RTTMs       float64   `json:"rttMs"`
	JitterMs    float64   `json:"jitterMs"`
	LostPct     float64   `json:"lostPct"`
	Omitted     bool      `json:"omitted"`
	StreamsAB   []float64 `json:"streamsAB,omitempty"`
	StreamsBA   []float64 `json:"streamsBA,omitempty"`
}

// Summary 一次测速的汇总
type Summary struct {
	AB          float64 `json:"ab"` // 平均吞吐（接收端统计），未测该方向为 0
	BA          float64 `json:"ba"`
	PeakAB      float64 `json:"peakAB"`
	PeakBA      float64 `json:"peakBA"`
	Retransmits int     `json:"retransmits"`
	RTTMs       float64 `json:"rttMs"`
	JitterMs    float64 `json:"jitterMs"`
	LostPct     float64 `json:"lostPct"`
	Seconds     float64 `json:"seconds"`
	CPUClient   float64 `json:"cpuClient"`
	CPUServer   float64 `json:"cpuServer"`
}

type ivSum struct {
	End           float64  `json:"end"`
	Seconds       float64  `json:"seconds"`
	BitsPerSecond float64  `json:"bits_per_second"`
	Retransmits   int      `json:"retransmits"`
	JitterMs      *float64 `json:"jitter_ms"`
	LostPercent   float64  `json:"lost_percent"`
	Omitted       bool     `json:"omitted"`
	Sender        bool     `json:"sender"`
}

type ivStream struct {
	ivSum
	RTT float64 `json:"rtt"` // 微秒
}

type intervalData struct {
	Streams         []ivStream `json:"streams"`
	Sum             *ivSum     `json:"sum"`
	SumBidirReverse *ivSum     `json:"sum_bidir_reverse"`
}

type endData struct {
	Streams []struct {
		Sender *struct {
			MeanRTT float64 `json:"mean_rtt"`
		} `json:"sender"`
	} `json:"streams"`
	Sum                     *ivSum `json:"sum"`
	SumSent                 *ivSum `json:"sum_sent"`
	SumReceived             *ivSum `json:"sum_received"`
	SumBidirReverse         *ivSum `json:"sum_bidir_reverse"`
	SumSentBidirReverse     *ivSum `json:"sum_sent_bidir_reverse"`
	SumReceivedBidirReverse *ivSum `json:"sum_received_bidir_reverse"`
	CPU                     struct {
		HostTotal   float64 `json:"host_total"`
		RemoteTotal float64 `json:"remote_total"`
	} `json:"cpu_utilization_percent"`
}

// streamParser 逐行解析 iperf3 --json-stream 输出
type streamParser struct {
	flow     flow
	trustRTT bool // macOS 的 iperf3 RTT 与 ping 对不上，只信 Linux 客户端（内核 tcp_info，微秒）
	samples  []Sample
	end      *endData
	errMsg   string
}

// Feed 喂一行；产生采样点时返回非 nil
func (sp *streamParser) Feed(line string) *Sample {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "{") {
		return nil
	}
	var ev struct {
		Event string          `json:"event"`
		Data  json.RawMessage `json:"data"`
	}
	if json.Unmarshal([]byte(line), &ev) != nil {
		return nil
	}
	switch ev.Event {
	case "interval":
		var iv intervalData
		if json.Unmarshal(ev.Data, &iv) != nil || iv.Sum == nil {
			return nil
		}
		s := sp.sampleFrom(iv)
		sp.samples = append(sp.samples, s)
		return &sp.samples[len(sp.samples)-1]
	case "end":
		var e endData
		if json.Unmarshal(ev.Data, &e) == nil {
			sp.end = &e
		}
	case "error":
		var msg string
		if json.Unmarshal(ev.Data, &msg) != nil {
			msg = string(ev.Data)
		}
		sp.errMsg = msg
	}
	return nil
}

// assign 把客户端视角的 c→s / s→c 吞吐落到 A→B / B→A
func (sp *streamParser) assign(c2s bool, v float64, s *Sample) {
	if c2s == sp.flow.c2sIsAB() {
		s.AB += v
	} else {
		s.BA += v
	}
}

func (sp *streamParser) sampleFrom(iv intervalData) Sample {
	s := Sample{T: iv.Sum.End, Omitted: iv.Sum.Omitted}
	mainC2S := !sp.flow.reverse
	sp.assign(mainC2S, iv.Sum.BitsPerSecond, &s)
	s.Retransmits += iv.Sum.Retransmits
	takeUDP(iv.Sum, &s)
	if iv.SumBidirReverse != nil {
		sp.assign(false, iv.SumBidirReverse.BitsPerSecond, &s)
		s.Retransmits += iv.SumBidirReverse.Retransmits
		takeUDP(iv.SumBidirReverse, &s)
	}
	var rttSum float64
	var rttN int
	for _, st := range iv.Streams {
		// 流的 sender 是客户端视角：true 即客户端在发（c→s）
		if st.Sender == sp.flow.c2sIsAB() {
			s.StreamsAB = append(s.StreamsAB, st.BitsPerSecond)
		} else {
			s.StreamsBA = append(s.StreamsBA, st.BitsPerSecond)
		}
		if sp.trustRTT && st.Sender && st.RTT > 0 {
			rttSum += st.RTT
			rttN++
		}
	}
	if rttN > 0 {
		s.RTTMs = rttSum / float64(rttN) / 1000
	}
	return s
}

// takeUDP 接收端的 sum 才带抖动与丢包，取两方向中较差的
func takeUDP(sum *ivSum, s *Sample) {
	if sum.JitterMs == nil {
		return
	}
	if *sum.JitterMs > s.JitterMs {
		s.JitterMs = *sum.JitterMs
	}
	if sum.LostPercent > s.LostPct {
		s.LostPct = sum.LostPercent
	}
}

// Summary 汇总：优先用 end 事件（接收端统计），中途停止时按采样平均
func (sp *streamParser) Summary() Summary {
	var out Summary
	var nAB, nBA int
	var sumAB, sumBA float64
	for _, s := range sp.samples {
		if s.Omitted {
			continue
		}
		if s.AB > out.PeakAB {
			out.PeakAB = s.AB
		}
		if s.BA > out.PeakBA {
			out.PeakBA = s.BA
		}
		if s.AB > 0 {
			sumAB += s.AB
			nAB++
		}
		if s.BA > 0 {
			sumBA += s.BA
			nBA++
		}
		out.Retransmits += s.Retransmits
		if s.JitterMs > out.JitterMs {
			out.JitterMs = s.JitterMs
		}
		if s.LostPct > out.LostPct {
			out.LostPct = s.LostPct
		}
		out.Seconds = s.T
	}
	if nAB > 0 {
		out.AB = sumAB / float64(nAB)
	}
	if nBA > 0 {
		out.BA = sumBA / float64(nBA)
	}
	var rttSum float64
	var rttN int
	for _, s := range sp.samples {
		if s.RTTMs > 0 {
			rttSum += s.RTTMs
			rttN++
		}
	}
	if rttN > 0 {
		out.RTTMs = rttSum / float64(rttN)
	}

	e := sp.end
	if e == nil {
		return out
	}
	main := firstSum(e.SumReceived, e.Sum, e.SumSent)
	if main != nil {
		ab, ba := out.AB, out.BA
		tmp := Sample{}
		sp.assign(!sp.flow.reverse, main.BitsPerSecond, &tmp)
		if rev := firstSum(e.SumReceivedBidirReverse, e.SumBidirReverse); rev != nil && sp.flow.bidir {
			sp.assign(false, rev.BitsPerSecond, &tmp)
		}
		out.AB, out.BA = tmp.AB, tmp.BA
		if out.AB == 0 {
			out.AB = ab
		}
		if out.BA == 0 {
			out.BA = ba
		}
		out.Seconds = main.Seconds
	}
	out.Retransmits = 0
	if e.SumSent != nil {
		out.Retransmits += e.SumSent.Retransmits
	}
	if e.SumSentBidirReverse != nil {
		out.Retransmits += e.SumSentBidirReverse.Retransmits
	}
	udp := Sample{}
	for _, s := range []*ivSum{e.Sum, e.SumReceived, e.SumBidirReverse, e.SumReceivedBidirReverse} {
		if s != nil {
			takeUDP(s, &udp)
		}
	}
	if udp.JitterMs > 0 || udp.LostPct > 0 {
		out.JitterMs, out.LostPct = udp.JitterMs, udp.LostPct
	}
	rttSum, rttN = 0, 0
	for _, st := range e.Streams {
		if sp.trustRTT && st.Sender != nil && st.Sender.MeanRTT > 0 {
			rttSum += st.Sender.MeanRTT
			rttN++
		}
	}
	if rttN > 0 {
		out.RTTMs = rttSum / float64(rttN) / 1000
	}
	out.CPUClient, out.CPUServer = e.CPU.HostTotal, e.CPU.RemoteTotal
	return out
}

func firstSum(list ...*ivSum) *ivSum {
	for _, s := range list {
		if s != nil && s.BitsPerSecond > 0 {
			return s
		}
	}
	return nil
}

var errProbeTimeout = errors.New("探测未完成（超时或连接中断）")

// probeTimeoutReason 探测超时的提示：带上端口，NAT / 安全组场景用户才知道该放行或映射哪个端口
func probeTimeoutReason(port int) string {
	return fmt.Sprintf("探测 TCP %d 未完成（超时或连接中断）：可能被防火墙 / 安全组拦截，或公网地址经过 NAT 没有把 TCP %d 映射到服务端；UDP 测速还需放行 UDP %d", port, port, port)
}

// probeResult 解析连通探测（iperf3 -J 单次小流量）
func probeResult(out []byte, port int) (ok bool, rttMs float64, reason string) {
	var r struct {
		Error string  `json:"error"`
		End   endData `json:"end"`
	}
	text := strings.TrimSpace(string(out))
	if i := strings.Index(text, "{"); i > 0 {
		text = text[i:]
	}
	if err := json.Unmarshal([]byte(text), &r); err != nil {
		if text == "" || strings.HasPrefix(text, "{") {
			return false, 0, probeTimeoutReason(port)
		}
		return false, 0, firstLine(text)
	}
	if r.Error != "" {
		low := strings.ToLower(r.Error)
		switch {
		case strings.Contains(low, "busy"):
			// 服务端忙说明 TCP 已连通（并发探测撞上了）
			return true, 0, ""
		case strings.Contains(low, "timed out"):
			return false, 0, fmt.Sprintf("连接 TCP %d 超时：可能被防火墙 / 安全组拦截，或 NAT 没有映射该端口；请放行 TCP %d（UDP 测速另需 UDP %d）", port, port, port)
		case strings.Contains(low, "refused"):
			return false, 0, fmt.Sprintf("连接被拒绝：端口 %d 未监听或被防火墙拒绝", port)
		case strings.Contains(low, "no route"), strings.Contains(low, "unreachable"):
			return false, 0, "没有到该地址的路由"
		}
		return false, 0, r.Error
	}
	for _, st := range r.End.Streams {
		if st.Sender != nil && st.Sender.MeanRTT > 0 {
			rttMs = st.Sender.MeanRTT / 1000
			break
		}
	}
	return true, rttMs, ""
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}
