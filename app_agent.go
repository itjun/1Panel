package main

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"sync"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/agentinstall"
	"diteng-pannel/internal/agentres"
	"diteng-pannel/internal/sshconfig"
)

// Agent agent 状态与历史数据服务（数据全部来自目标主机上的 spanel-agent）
type Agent App

// AgentStatus 探测主机 agent 状态（30s 缓存；force 跳过缓存）
func (s *Agent) AgentStatus(host string, force bool) (agentcli.Status, error) {
	return s.agentPool.Status(host, force), nil
}

// AgentHealth agent 健康/自身资源（含版本、RSS、丢弃计数）
func (s *Agent) AgentHealth(host string) (agentcli.Health, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return agentcli.Health{}, err
	}
	var h agentcli.Health
	err = cli.GetJSON(context.Background(), "/health", &h)
	return h, err
}

// AgentCurrent 最新采样 + 静态信息（概览页轮询；比 /collect 零命令更快）
func (s *Agent) AgentCurrent(host string) (agentcli.CurrentResponse, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return agentcli.CurrentResponse{}, err
	}
	var r agentcli.CurrentResponse
	err = cli.GetJSON(context.Background(), "/metrics/current", &r)
	return r, err
}

// AgentRange 历史时间序列（from/to 为 Unix 秒；src: auto/raw/agg）
func (s *Agent) AgentRange(host string, from, to int64, src string) (agentcli.RangeResponse, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return agentcli.RangeResponse{}, err
	}
	if src == "" {
		src = "auto"
	}
	var r agentcli.RangeResponse
	q := url.Values{"from": {strconv.FormatInt(from, 10)}, "to": {strconv.FormatInt(to, 10)}, "src": {src}}
	err = cli.GetJSON(context.Background(), "/metrics/range?"+q.Encode(), &r)
	return r, err
}

// AgentSummary 最近 1h/6h/24h/7d 摘要
func (s *Agent) AgentSummary(host string) ([]agentcli.SummaryRange, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return nil, err
	}
	var r []agentcli.SummaryRange
	err = cli.GetJSON(context.Background(), "/metrics/summary", &r)
	return r, err
}

// AgentEvents agent 事件列表（默认最近 24h）
func (s *Agent) AgentEvents(host string) ([]agentcli.AgentEvent, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return nil, err
	}
	var r []agentcli.AgentEvent
	err = cli.GetJSON(context.Background(), "/events", &r)
	return r, err
}

// AgentWatchStatus 分层探活卡片
func (s *Agent) AgentWatchStatus(host string) ([]agentcli.WatchStatus, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return nil, err
	}
	var r []agentcli.WatchStatus
	err = cli.GetJSON(context.Background(), "/watch/status", &r, true)
	return r, err
}

// AgentWatchInstances Java 应用实例表
func (s *Agent) AgentWatchInstances(host string) ([]agentcli.JavaAppInstance, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return nil, err
	}
	var r []agentcli.JavaAppInstance
	err = cli.GetJSON(context.Background(), "/watch/instances", &r, true)
	return r, err
}

// AgentAppShutdown 下线单个 Java 实例（SIGTERM → 轮询 → SIGKILL → screen quit）
func (s *Agent) AgentAppShutdown(host string, req agentcli.AppShutdownReq) (agentcli.AppShutdownResult, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return agentcli.AppShutdownResult{}, err
	}
	var r agentcli.AppShutdownResult
	err = cli.PostJSON(context.Background(), "/op/app-shutdown", req, &r)
	return r, err
}

// AgentWatchRange JAR 采样序列
func (s *Agent) AgentWatchRange(host, service string, from, to int64) (agentcli.WatchRangeResponse, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return agentcli.WatchRangeResponse{}, err
	}
	q := url.Values{"from": {strconv.FormatInt(from, 10)}, "to": {strconv.FormatInt(to, 10)}}
	if service != "" {
		q.Set("service", service)
	}
	var r agentcli.WatchRangeResponse
	err = cli.GetJSON(context.Background(), "/watch/range?"+q.Encode(), &r, true)
	return r, err
}

// AgentWatchEvents 分层探活事件
func (s *Agent) AgentWatchEvents(host, service string, from, to int64) ([]agentcli.WatchEventRow, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	if from > 0 {
		q.Set("from", strconv.FormatInt(from, 10))
	}
	if to > 0 {
		q.Set("to", strconv.FormatInt(to, 10))
	}
	if service != "" {
		q.Set("service", service)
	}
	path := "/watch/events"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	var r []agentcli.WatchEventRow
	err = cli.GetJSON(context.Background(), path, &r, true)
	return r, err
}

// AgentGetWatch 拉取 watch.yml
func (s *Agent) AgentGetWatch(host string) (agentcli.WatchYAML, error) {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return agentcli.WatchYAML{}, err
	}
	var r agentcli.WatchYAML
	err = cli.GetJSON(context.Background(), "/admin/watch", &r)
	return r, err
}

// AgentPutWatch 下发并热加载 watch.yml
func (s *Agent) AgentPutWatch(host, yamlText string) error {
	cli, err := s.agentPool.Get(host)
	if err != nil {
		return err
	}
	var out map[string]any
	return cli.PostJSON(context.Background(), "/admin/watch", map[string]string{"yaml": yamlText}, &out)
}

// ============ 安装 / 更新 / 卸载（SSH 管理面，一次性命令） ============

// AgentProbeInfo 探测目标主机（架构/systemd/安装状态）
func (s *Agent) AgentProbeInfo(host string) (agentinstall.ProbeInfo, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return agentinstall.ProbeInfo{}, err
	}
	return s.installer.Probe(host, opt)
}

// AgentLatestVersion 面板内置的 agent 版本（前端比对显示「可更新」）
func (s *Agent) AgentLatestVersion() string {
	return agentres.AgentVersion
}

// AgentEmbedded 面板是否已内置该架构的 agent 二进制
func (s *Agent) AgentEmbedded(arch string) bool {
	return agentres.HasBinary(arch)
}

// InstallAgent 安装或更新单台（幂等）：探测 → 上传校验 → 原子替换 → systemd 启动
// → 隧道健康检查（版本比对）→ 失败自动回滚旧版。
func (s *Agent) InstallAgent(host string) error {
	_, err := s.installAgentOn(host)
	return err
}

// AgentBatchResult 批量安装/更新单台结果
type AgentBatchResult struct {
	Host    string `json:"host"`
	OK      bool   `json:"ok"`
	Version string `json:"version"` // 成功时安装到的版本
	Error   string `json:"error,omitempty"`
}

// AgentBatchInstall 批量安装/更新（幂等，全部并行；单台失败不影响其余）。
// hosts 为空时自动覆盖 ssh config 里的全部主机。
func (s *Agent) AgentBatchInstall(hosts []string) ([]AgentBatchResult, error) {
	if len(hosts) == 0 {
		parsed, err := sshconfig.Parse()
		if err != nil {
			return nil, err
		}
		for _, h := range parsed {
			if !sshconfig.IsGitHost(h) {
				hosts = append(hosts, h.Name)
			}
		}
	}
	results := make([]AgentBatchResult, len(hosts))
	var wg sync.WaitGroup
	for i, host := range hosts {
		wg.Add(1)
		go func(idx int, h string) {
			defer wg.Done()
			r := AgentBatchResult{Host: h}
			if v, err := s.installAgentOn(h); err != nil {
				r.Error = err.Error()
			} else {
				r.OK, r.Version = true, v
			}
			results[idx] = r
		}(i, host)
	}
	wg.Wait()
	return results, nil
}

// AgentInstallEvent 单台安装进度事件（事件名 agent-install-progress），
// 前端安装对话框据此刷新步骤条。step 取 probe/upload/replace/start/verify/done/error。
type AgentInstallEvent struct {
	Host    string `json:"host"`
	Step    string `json:"step"`
	Percent int    `json:"percent"` // 0~100；不确定时 -1
	Text    string `json:"text,omitempty"`
}

// installAgentOn 在单台主机上执行完整安装流程，成功返回安装到的版本号。
// 各阶段经 agent-install-progress 事件推送进度，供前端安装对话框展示。
func (s *Agent) installAgentOn(host string) (string, error) {
	emit := func(step, text string, percent int) {
		s.app.Event.Emit("agent-install-progress", AgentInstallEvent{
			Host: host, Step: step, Percent: percent, Text: text,
		})
	}
	fail := func(err error) (string, error) {
		emit("error", err.Error(), -1)
		return "", err
	}

	emit("probe", "探测主机状态", -1)
	opt, err := connectOptionFor(host)
	if err != nil {
		return fail(err)
	}
	info, err := s.installer.Probe(host, opt)
	if err != nil {
		return fail(err)
	}

	// 已在跑且版本与面板内置一致：跳过上传/替换
	if info.ServiceState == "active" {
		st := s.agentPool.Status(host, true)
		if st.OK && st.Version == agentres.AgentVersion {
			emit("done", "已是最新 v"+st.Version+"，跳过安装", -1)
			return st.Version, nil
		}
	}

	bin, sum, err := agentres.Binary(info.Arch)
	if err != nil {
		return fail(err)
	}

	if err := s.installer.Install(host, opt, bin, sum, func(step string, percent int, text string) {
		emit(step, text, percent)
	}); err != nil {
		return fail(err)
	}
	// 全新安装后 token 由 agent 生成，面板缓存的旧 token 必须失效
	if cli, err := s.agentPool.GetWithOpt(host, opt); err == nil {
		cli.ResetToken()
	}

	// 健康检查：远端端口就绪 + 隧道版本号一致
	if err := s.installer.WaitHealthy(host, opt, 30*time.Second, func(step string, percent int, text string) {
		emit(step, text, percent)
	}); err != nil {
		_ = s.installer.Rollback(host, opt)
		return fail(fmt.Errorf("%w（已回滚旧版本）", err))
	}
	emit("verify", "验证版本一致性", -1)
	cli, err := s.agentPool.GetWithOpt(host, opt)
	if err != nil {
		return fail(err)
	}
	var h agentcli.Health
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := cli.GetJSON(ctx, "/health", &h); err != nil {
		_ = s.installer.Rollback(host, opt)
		return fail(fmt.Errorf("健康检查失败: %v（已回滚旧版本）", err))
	}
	if h.Version != agentres.AgentVersion {
		_ = s.installer.Rollback(host, opt)
		return fail(fmt.Errorf("远端版本 %s 与内置 %s 不一致（已回滚）", h.Version, agentres.AgentVersion))
	}
	s.agentPool.InvalidateStatus(host)
	emit("done", "安装完成 v"+h.Version, -1)
	return h.Version, nil
}

// UninstallAgent 卸载 agent；keepData=true 保留数据目录（重装可续看历史）
func (s *Agent) UninstallAgent(host string, keepData bool) error {
	opt, err := connectOptionFor(host)
	if err != nil {
		return err
	}
	if err := s.installer.Uninstall(host, opt, keepData); err != nil {
		return err
	}
	if cli, err := s.agentPool.GetWithOpt(host, opt); err == nil {
		cli.ResetToken()
	}
	s.agentPool.InvalidateStatus(host)
	return nil
}
