package speedtest

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// GroupRequest 分组测速请求
type GroupRequest struct {
	Group  string   `json:"group"` // 分组名（展示与历史用）
	Hosts  []string `json:"hosts"`
	Mode   string   `json:"mode"`   // star / mesh
	Center string   `json:"center"` // 星型中心机
	Params Params   `json:"params"`
}

// BatchEvent 分组测速进度：Index < 0 时 Pairs 为初始轮次列表
type BatchEvent struct {
	BatchID string       `json:"batchId"`
	Index   int          `json:"index"`
	Total   int          `json:"total"`
	Pair    *PairResult  `json:"pair,omitempty"`
	Pairs   []PairResult `json:"pairs,omitempty"`
}

// StartGroup 启动分组测速（只走局域网，依次执行）
func (s *Service) StartGroup(req GroupRequest) (string, error) {
	hosts := uniqueHosts(req.Hosts)
	if len(hosts) < 2 {
		return "", errors.New("分组内至少需要 2 台主机")
	}
	var pairs []PairResult
	switch req.Mode {
	case KindStar:
		if !contains(hosts, req.Center) {
			return "", errors.New("请选择分组内的中心机")
		}
		// 星型每轮双向同时测，一轮拿到 A→B 与 B→A
		req.Params.Direction = DirBidir
		for _, h := range hosts {
			if h != req.Center {
				pairs = append(pairs, PairResult{A: req.Center, B: h, Status: "pending"})
			}
		}
	case KindMesh:
		req.Params.Direction = DirForward
		for _, a := range hosts {
			for _, b := range hosts {
				if a != b {
					pairs = append(pairs, PairResult{A: a, B: b, Status: "pending"})
				}
			}
		}
	default:
		return "", errors.New("未知的分组测速方式")
	}
	req.Params.Normalize()
	eps := make([]endpoint, len(hosts))
	for i, h := range hosts {
		ep, err := s.endpoint(h)
		if err != nil {
			return "", err
		}
		if ep.local() {
			return "", errors.New("分组测速不包含本机")
		}
		eps[i] = ep
	}
	id, ctx, err := s.begin()
	if err != nil {
		return "", err
	}
	go s.runGroup(ctx, id, req, hosts, eps, pairs)
	return id, nil
}

func (s *Service) runGroup(ctx context.Context, id string, req GroupRequest, hosts []string, eps []endpoint, pairs []PairResult) {
	defer s.finish(id)
	total := len(pairs)
	s.emit(EventBatch, BatchEvent{BatchID: id, Index: -1, Total: total, Pairs: pairs})
	s.emitState(id, PhasePrepare, fmt.Sprintf("准备 %d 台主机：上传 iperf3 并读取网卡", len(hosts)))
	infos, _ := s.prepare(ctx, eps)
	byHost := map[string]epInfo{}
	for _, in := range infos {
		byHost[in.view.ID] = in
	}

	for i := range pairs {
		p := &pairs[i]
		if ctx.Err() != nil {
			p.Status = PhaseStopped
			s.emit(EventBatch, BatchEvent{BatchID: id, Index: i, Total: total, Pair: p})
			continue
		}
		s.runGroupPair(ctx, id, i, total, p, byHost[p.A], byHost[p.B], req.Params)
	}

	rec := Record{
		ID: id, Kind: req.Mode, CreatedAt: time.Now().UnixMilli(), Params: req.Params,
		Group: req.Group, Hosts: hosts, Center: req.Center, Pairs: pairs, Status: PhaseDone,
	}
	phase, msg := PhaseDone, "分组测速完成"
	if ctx.Err() != nil {
		phase, msg = PhaseStopped, "已停止"
		rec.Status = PhaseStopped
	}
	_ = s.history.Add(rec)
	s.emit(EventState, StateEvent{RunID: id, Phase: phase, Message: msg, RecordID: id})
}

func (s *Service) runGroupPair(ctx context.Context, id string, i, total int, p *PairResult, a, b epInfo, params Params) {
	push := func() {
		cp := *p
		cp.Samples = nil
		s.emit(EventBatch, BatchEvent{BatchID: id, Index: i, Total: total, Pair: &cp})
	}
	if a.view.Error != "" || b.view.Error != "" {
		p.Status, p.Reason = PhaseFailed, firstNonEmpty(a.view.Error, b.view.Error)
		push()
		return
	}
	p.Status = PhaseProbe
	push()
	var cands []Candidate
	for _, c := range BuildCandidates(a.view, b.view) {
		if c.Kind == KindLAN {
			cands = append(cands, c)
		}
	}
	if len(cands) == 0 {
		p.Status, p.Reason = "nolan", "不在同一网段："+segmentsText(a.view, b.view)
		push()
		return
	}
	s.probe(ctx, a.ep, b.ep, cands, params.Port)
	best := summarize(cands, KindLAN)
	if !best.Available {
		p.Status = "nolan"
		p.Reason = firstNonEmpty(best.Reason, "局域网不可达")
		if best.Best != nil {
			p.Path = best.Best
		}
		push()
		return
	}
	p.Path = best.Best
	p.Status = PhaseRunning
	push()
	s.emitState(id, PhaseRunning, fmt.Sprintf("第 %d/%d 轮：%s ⇄ %s", i+1, total, p.A, p.B))
	sum, samples, err := s.runPair(ctx, id, i, a.ep, b.ep, *best.Best, params)
	p.Summary = &sum
	p.Samples = stripStreams(samples)
	switch {
	case errors.Is(err, context.Canceled):
		p.Status = PhaseStopped
	case err != nil:
		p.Status, p.Reason = PhaseFailed, err.Error()
	default:
		p.Status = PhaseDone
	}
	push()
}

func uniqueHosts(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, h := range in {
		if h != "" && !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
	}
	return out
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
