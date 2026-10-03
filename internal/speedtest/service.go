// Package speedtest 基于内置 iperf3 的网络测速：路径识别（局域网 / 广域网实测）、
// 两机测速（实时采样经事件推送）、分组星型 / 全互测矩阵，以及本机历史记录。
package speedtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/sshd"
)

// 事件名
const (
	EventState  = "speedtest-state"
	EventSample = "speedtest-sample"
	EventBatch  = "speedtest-batch"
)

// 阶段
const (
	PhasePrepare   = "prepare"
	PhaseProvision = "provision"
	PhaseProbe     = "probe"
	PhaseRunning   = "running"
	PhaseDone      = "done"
	PhaseFailed    = "failed"
	PhaseStopped   = "stopped"
)

// StateEvent 阶段变化
type StateEvent struct {
	RunID    string   `json:"runId"`
	Phase    string   `json:"phase"`
	Message  string   `json:"message"`
	Summary  *Summary `json:"summary,omitempty"`
	RecordID string   `json:"recordId,omitempty"`
}

// SampleEvent 实时采样；Pair 为分组测速中的轮次下标，两机测速为 -1
type SampleEvent struct {
	RunID  string `json:"runId"`
	Pair   int    `json:"pair"`
	Sample Sample `json:"sample"`
}

// Options 依赖注入
type Options struct {
	Mgr           *sshd.Manager
	ConnectOption func(host string) (sshd.ConnectOption, error)
	Emit          func(name string, data any)
	DataDir       string
}

// Service 测速服务；同一时间只跑一个测速任务（iperf3 服务端一次只服务一个测试，并行也会互相干扰）
type Service struct {
	mgr     *sshd.Manager
	optFor  func(string) (sshd.ConnectOption, error)
	emit    func(string, any)
	dataDir string
	history *History

	mu       sync.Mutex
	activeID string
	cancel   context.CancelFunc
	prov     map[string]string // host|hostname -> goos
}

// New 创建服务
func New(o Options) *Service {
	s := &Service{
		mgr:     o.Mgr,
		optFor:  o.ConnectOption,
		emit:    o.Emit,
		dataDir: o.DataDir,
		prov:    map[string]string{},
	}
	s.history = newHistory(o.DataDir)
	return s
}

func (s *Service) provisioned(key string, goos *string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	g, ok := s.prov[key]
	if ok {
		*goos = g
	}
	return ok
}

func (s *Service) markProvisioned(key, goos string) {
	s.mu.Lock()
	s.prov[key] = goos
	s.mu.Unlock()
}

func (s *Service) emitState(runID, phase, msg string) {
	if s.emit != nil && runID != "" {
		s.emit(EventState, StateEvent{RunID: runID, Phase: phase, Message: msg})
	}
}

func (s *Service) endpoint(id string) (endpoint, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, errors.New("请选择主机")
	}
	if id == LocalID {
		return &localEP{svc: s}, nil
	}
	opt, err := s.optFor(id)
	if err != nil {
		return nil, err
	}
	return &remoteEP{svc: s, host: id, opt: opt}, nil
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return time.Now().Format("20060102150405") + "-" + hex.EncodeToString(b)
}

// begin 占用唯一的任务槽
func (s *Service) begin() (string, context.Context, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeID != "" {
		return "", nil, errors.New("已有测速任务在进行，请先停止")
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.activeID, s.cancel = newID(), cancel
	return s.activeID, ctx, nil
}

func (s *Service) finish(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeID == id {
		s.cancel()
		s.activeID, s.cancel = "", nil
	}
}

// Stop 停止进行中的任务（两机或分组）
func (s *Service) Stop(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil && (id == "" || id == s.activeID) {
		s.cancel()
	}
}

// ActiveID 当前任务 ID（前端切页回来时恢复状态用）
func (s *Service) ActiveID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.activeID
}

// ===== 路径识别 =====

type epInfo struct {
	ep   endpoint
	view EndpointView
}

// prepare 并行上传 iperf3 并采集地址
func (s *Service) prepare(ctx context.Context, eps []endpoint) ([]epInfo, error) {
	out := make([]epInfo, len(eps))
	errs := make([]error, len(eps))
	var wg sync.WaitGroup
	for i, ep := range eps {
		wg.Add(1)
		go func(i int, ep endpoint) {
			defer wg.Done()
			v := EndpointView{ID: ep.id(), Label: ep.label(), Local: ep.local()}
			if err := ep.provision(ctx); err != nil {
				errs[i] = err
				v.Error = err.Error()
			} else if addrs, err := ep.addrs(ctx); err != nil {
				errs[i] = err
				v.Error = err.Error()
			} else {
				v.Addrs = addrs
			}
			v.Segments = Segments(v.Addrs)
			out[i] = epInfo{ep: ep, view: v}
		}(i, ep)
	}
	wg.Wait()
	return out, errors.Join(errs...)
}

// DetectPaths 识别 A、B 之间可用的局域网 / 广域网路径（以实测为准）
func (s *Service) DetectPaths(a, b string, port int) (PathReport, error) {
	if a == b {
		return PathReport{}, errors.New("A、B 不能是同一台主机")
	}
	ea, err := s.endpoint(a)
	if err != nil {
		return PathReport{}, err
	}
	eb, err := s.endpoint(b)
	if err != nil {
		return PathReport{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	infos, err := s.prepare(ctx, []endpoint{ea, eb})
	report := PathReport{A: infos[0].view, B: infos[1].view}
	if err != nil {
		report.Decision = DecideNone
		report.Message = err.Error()
		return report, nil
	}
	report.Candidates = BuildCandidates(report.A, report.B)
	report.Port = s.probe(ctx, infos[0].ep, infos[1].ep, report.Candidates, port)
	Decide(&report)
	return report, nil
}

// probe 在需要的服务端侧起临时 iperf3 -s，客户端并行连通探测；返回实际使用的端口
func (s *Service) probe(ctx context.Context, ea, eb endpoint, cands []Candidate, port int) int {
	sides := map[string]endpoint{SideA: ea, SideB: eb}
	type srv struct {
		port   int
		handle string
		err    error
	}
	servers := map[string]*srv{}
	for _, c := range cands {
		if servers[c.Server] != nil {
			continue
		}
		p, h, err := sides[c.Server].startServer(ctx, port, 45*time.Second)
		servers[c.Server] = &srv{port: p, handle: h, err: err}
	}
	defer func() {
		for side, sv := range servers {
			if sv.err == nil {
				sides[side].stopServer(sv.handle)
			}
		}
	}()

	var wg sync.WaitGroup
	for i := range cands {
		c := &cands[i]
		sv := servers[c.Server]
		if sv.err != nil {
			c.Probed = true
			c.Reason = fmt.Sprintf("无法在 %s 上启动 iperf3 服务端：%v", sides[c.Server].label(), sv.err)
			continue
		}
		wg.Add(1)
		go func(c *Candidate, port int) {
			defer wg.Done()
			cli := sides[other(c.Server)]
			args := []string{"-c", c.Target.IP, "-p", strconv.Itoa(port), "--connect-timeout", "1500", "-n", "256K", "-J"}
			out, err := cli.iperfOnce(ctx, args, 6*time.Second)
			c.Probed = true
			if len(out) == 0 && err != nil {
				c.Reason = err.Error()
				if strings.Contains(c.Reason, "超时") {
					c.Reason = errProbeTimeout.Error()
				}
				return
			}
			c.OK, c.RTTMs, c.Reason = probeResult(out, port)
			if !cli.linux() {
				c.RTTMs = 0
			}
			if c.OK {
				if rtt := cli.ping(ctx, c.Target.IP); rtt > 0 {
					c.RTTMs = rtt
				}
			}
		}(c, sv.port)
	}
	wg.Wait()
	used := port
	for _, side := range []string{SideB, SideA} {
		if sv := servers[side]; sv != nil && sv.err == nil {
			used = sv.port
			break
		}
	}
	return used
}

// ===== 两机测速 =====

// StartRequest 两机测速请求；Server / Target 来自 DetectPaths 选中的候选
type StartRequest struct {
	A      string    `json:"a"`
	B      string    `json:"b"`
	Path   Candidate `json:"path"`
	Params Params    `json:"params"`
}

// Start 启动两机测速（异步），返回任务 ID；进度经事件推送
func (s *Service) Start(req StartRequest) (string, error) {
	if req.A == req.B {
		return "", errors.New("A、B 不能是同一台主机")
	}
	if strings.TrimSpace(req.Path.Target.IP) == "" || (req.Path.Server != SideA && req.Path.Server != SideB) {
		return "", errors.New("请先识别并选择测速路径")
	}
	ea, err := s.endpoint(req.A)
	if err != nil {
		return "", err
	}
	eb, err := s.endpoint(req.B)
	if err != nil {
		return "", err
	}
	if (req.Path.Server == SideA && ea.local()) || (req.Path.Server == SideB && eb.local()) {
		return "", errors.New("本机只能作为客户端，请重新识别路径")
	}
	req.Params.Normalize()
	id, ctx, err := s.begin()
	if err != nil {
		return "", err
	}
	go func() {
		defer s.finish(id)
		s.emitState(id, PhasePrepare, "准备 iperf3")
		rec := Record{
			ID: id, Kind: KindPair, CreatedAt: time.Now().UnixMilli(),
			A: ea.label(), B: eb.label(), AID: req.A, BID: req.B,
			Params: req.Params, Path: &req.Path,
		}
		sum, samples, err := s.runPair(ctx, id, -1, ea, eb, req.Path, req.Params)
		rec.Samples = stripStreams(samples)
		rec.Summary = &sum
		phase, msg := PhaseDone, "测速完成"
		switch {
		case errors.Is(err, context.Canceled):
			phase, msg = PhaseStopped, "已停止"
		case err != nil:
			phase, msg = PhaseFailed, err.Error()
		}
		rec.Status, rec.Error = phase, ""
		if phase == PhaseFailed {
			rec.Error = msg
		}
		if len(samples) > 0 || phase == PhaseFailed {
			_ = s.history.Add(rec)
		}
		s.emit(EventState, StateEvent{RunID: id, Phase: phase, Message: msg, Summary: &sum, RecordID: rec.ID})
	}()
	return id, nil
}

// runPair 一轮测速：上传 → 起服务端 → 客户端流式采样 → 收尾
func (s *Service) runPair(ctx context.Context, runID string, pair int, ea, eb endpoint, path Candidate, p Params) (Summary, []Sample, error) {
	var wg sync.WaitGroup
	var errA, errB error
	wg.Add(2)
	go func() { defer wg.Done(); errA = ea.provision(ctx) }()
	go func() { defer wg.Done(); errB = eb.provision(ctx) }()
	wg.Wait()
	if err := errors.Join(errA, errB); err != nil {
		return Summary{}, nil, err
	}

	srv, cli := eb, ea
	if path.Server == SideA {
		srv, cli = ea, eb
	}
	maxDur := time.Duration(p.Duration+p.Omit+30) * time.Second
	port, handle, err := srv.startServer(ctx, p.Port, maxDur+30*time.Second)
	if err != nil {
		return Summary{}, nil, fmt.Errorf("在 %s 上启动 iperf3 服务端失败：%v", srv.label(), err)
	}
	defer srv.stopServer(handle)

	f := newFlow(path.Server, p.Direction)
	args := clientArgs(path.Target.IP, port, p, f, cli.linux())
	s.emitState(runID, PhaseRunning, fmt.Sprintf("测速中：%s → %s:%d", cli.label(), path.Target.IP, port))
	sp := &streamParser{flow: f, trustRTT: cli.linux()}
	err = cli.iperfStream(ctx, args, maxDur, func(line string) {
		if smp := sp.Feed(line); smp != nil && s.emit != nil {
			s.emit(EventSample, SampleEvent{RunID: runID, Pair: pair, Sample: *smp})
		}
	})
	sum := sp.Summary()
	if sum.RTTMs == 0 {
		sum.RTTMs = path.RTTMs
	}
	if ctx.Err() != nil {
		return sum, sp.samples, context.Canceled
	}
	if sp.errMsg != "" {
		return sum, sp.samples, errors.New(udpHint(p, sp.errMsg))
	}
	if err != nil && sp.end == nil {
		return sum, sp.samples, err
	}
	return sum, sp.samples, nil
}

func udpHint(p Params, msg string) string {
	if p.Protocol == "udp" {
		return msg + "（UDP 需要服务端同时放行 UDP 端口）"
	}
	return msg
}

func stripStreams(in []Sample) []Sample {
	out := make([]Sample, len(in))
	for i, s := range in {
		s.StreamsAB, s.StreamsBA = nil, nil
		out[i] = s
	}
	return out
}

// ===== 历史 =====

// ListHistory 历史列表（不含采样序列）
func (s *Service) ListHistory() []HistoryItem { return s.history.List() }

// GetHistory 单条完整记录
func (s *Service) GetHistory(id string) (Record, error) { return s.history.Get(id) }

// DeleteHistory 删除记录；id 为空时清空
func (s *Service) DeleteHistory(id string) error { return s.history.Delete(id) }
