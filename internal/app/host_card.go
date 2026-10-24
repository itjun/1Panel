package app

import (
	"context"
	"errors"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshd"
)

// HostCardSnapshot 首页只读快照；连接、Agent 与各项读数独立表达，失败不返回零值指标。
type HostCardSnapshot struct {
	Name            string             `json:"name"`
	Connection      string             `json:"connection"` // online / failed / unknown
	AgentState      string             `json:"agentState"` // running / missing / stopped / unknown
	AgentVersion    string             `json:"agentVersion"`
	Overview        *monitor.Overview  `json:"overview"`
	SampledAt       int64              `json:"sampledAt"` // Agent 原始采样时间（Unix 秒）
	Disks           []monitor.DiskInfo `json:"disks"`
	Error           string             `json:"error"`
	OverviewError   string             `json:"overviewError"`
	DiskError       string             `json:"diskError"`
	DetailsIncluded bool               `json:"detailsIncluded"`
}

type hostCardReader interface {
	GetJSON(context.Context, string, any, ...bool) error
}

// GetHostCardSnapshot 只读健康和指标，不调用 Status / tryHeal，不启动或安装远端服务。
// isDetailsIncluded 由首页按 30 秒节奏传入，普通轮询只读最新指标。
func (s *Overview) GetHostCardSnapshot(host string, isDetailsIncluded bool) (HostCardSnapshot, error) {
	opt, err := (*App)(s).connectOptionFor(host)
	if err != nil {
		return HostCardSnapshot{}, err
	}
	cli, err := s.agentPool.GetWithOpt(host, opt)
	if err != nil {
		return HostCardSnapshot{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	return readHostCardSnapshot(ctx, cli, host, isDetailsIncluded), nil
}

func readHostCardSnapshot(ctx context.Context, cli hostCardReader, host string, isDetailsIncluded bool) HostCardSnapshot {
	snap := HostCardSnapshot{Name: host, Connection: "unknown", AgentState: "unknown", DetailsIncluded: isDetailsIncluded}
	if isDetailsIncluded {
		var health agentcli.Health
		if err := cli.GetJSON(ctx, "/health", &health); err != nil {
			snap.setConnectionError(err)
			return snap
		}
		snap.Connection, snap.AgentState, snap.AgentVersion = "online", "running", health.Version
	}
	var current agentcli.CurrentResponse
	if err := cli.GetJSON(ctx, "/metrics/current", &current); err != nil {
		snap.OverviewError = err.Error()
		if !isDetailsIncluded {
			snap.setConnectionError(err)
		}
	} else {
		snap.Connection, snap.AgentState = "online", "running"
		if current.Metrics.TS <= 0 {
			snap.OverviewError = "尚无采样数据，请稍候"
		} else {
			overview := overviewFromAgent(current)
			snap.Overview = &overview
			snap.SampledAt = current.Metrics.TS
		}
	}
	if isDetailsIncluded {
		if err := cli.GetJSON(ctx, "/collect/disks", &snap.Disks, true); err != nil {
			snap.Disks = nil
			snap.DiskError = err.Error()
		}
	}
	return snap
}

func (s *HostCardSnapshot) setConnectionError(err error) {
	s.Error = err.Error()
	switch {
	case errors.Is(err, agentcli.ErrNotInstalled):
		s.Connection, s.AgentState = "online", "missing"
	case errors.Is(err, agentcli.ErrAgentUnreachable):
		s.Connection, s.AgentState = "online", "stopped"
	case errors.Is(err, sshd.ErrNoRoot):
		s.Connection = "unknown"
	case errors.Is(err, agentcli.ErrSSHConnection):
		s.Connection = "failed"
	case errors.Is(err, agentcli.ErrAgentResponse):
		s.Connection, s.AgentState = "online", "running"
	}
}
