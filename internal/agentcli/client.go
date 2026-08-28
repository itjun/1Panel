// Package agentcli 面板侧的 agent 访问客户端：
// 经 SSH 连接池的 direct-tcpip 隧道访问目标主机上的 spanel-agent HTTP API。
package agentcli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/sshd"
)

// AgentPort agent 默认端口（后续可随主机配置扩展）
const AgentPort = "127.0.0.1:39190"

// 请求超时：概览轮询等读库端点要快；按需采集（包列表等）允许更久
const (
	fastTimeout    = 5 * time.Second
	slowTimeout    = 45 * time.Second
	statusCacheTTL = 30 * time.Second
)

// ErrAgentUnreachable agent 未安装或未运行（端口拒绝/不通）
var ErrAgentUnreachable = errors.New("agent 不可达（未安装或未运行）")

// ErrNotInstalled token 文件不存在，视为未安装
var ErrNotInstalled = errors.New("agent 未安装")

// Health /health 响应
type Health struct {
	Version      string  `json:"version"`
	UptimeSec    int64   `json:"uptimeSec"`
	RSSKB        int64   `json:"rssKB"`
	CPUTimeSec   float64 `json:"cpuTimeSec"`
	Written      uint64  `json:"writtenSamples"`
	Dropped      uint64  `json:"droppedSamples"`
	LastWriteErr string  `json:"lastWriteErr"`
	DiskLow      bool    `json:"diskLow"`
}

// ============ 与 agent 的接口契约类型（json tag 与 agent 端一致） ============

// HostInfo 静态主机信息
type HostInfo struct {
	Hostname    string `json:"hostname"`
	Arch        string `json:"arch"`
	Kernel      string `json:"kernel"`
	OSRelease   string `json:"osRelease"`
	CPUModel    string `json:"cpuModel"`
	CPUCount    int    `json:"cpuCount"`
	IPAddress   string `json:"ipAddress"`
	Uptime      uint64 `json:"uptime"`
	CollectedAt int64  `json:"collectedAt"`
}

// CurrentPoint 最新采样
type CurrentPoint struct {
	TS             int64   `json:"ts"`
	CPUPercent     float64 `json:"cpuPercent"`
	Load1          float64 `json:"load1"`
	Load5          float64 `json:"load5"`
	Load15         float64 `json:"load15"`
	MemUsed        uint64  `json:"memUsed"`
	MemTotal       uint64  `json:"memTotal"`
	SwapUsed       uint64  `json:"swapUsed"`
	SwapTotal      uint64  `json:"swapTotal"`
	NetRxBytes     uint64  `json:"netRxBytes"`
	NetTxBytes     uint64  `json:"netTxBytes"`
	NetRxKBps      float64 `json:"netRxKBps"`
	NetTxKBps      float64 `json:"netTxKBps"`
	DiskReadBytes  uint64  `json:"diskReadBytes"`
	DiskWriteBytes uint64  `json:"diskWriteBytes"`
	DiskReadKBps   float64 `json:"diskReadKBps"`
	DiskWriteKBps  float64 `json:"diskWriteKBps"`
	DiskIOCount    uint64  `json:"diskIOCount"`
	DiskUsed       uint64  `json:"diskUsed"`
	DiskTotal      uint64  `json:"diskTotal"`
}

// CurrentResponse /metrics/current 响应
type CurrentResponse struct {
	Metrics CurrentPoint `json:"metrics"`
	Info    HostInfo     `json:"info"`
}

// RangePoint /metrics/range 数据点
type RangePoint struct {
	TS            int64   `json:"ts"`
	CPUPercent    float64 `json:"cpuPercent"`
	Load1         float64 `json:"load1"`
	MemUsed       uint64  `json:"memUsed"`
	NetRxKBps     float64 `json:"netRxKBps"`
	NetTxKBps     float64 `json:"netTxKBps"`
	DiskReadKBps  float64 `json:"diskReadKBps"`
	DiskWriteKBps float64 `json:"diskWriteKBps"`
}

// RangeResponse /metrics/range 响应
type RangeResponse struct {
	Src    string       `json:"src"`
	Points []RangePoint `json:"points"`
}

// SummaryRange /metrics/summary 单窗口摘要
type SummaryRange struct {
	Name       string  `json:"name"`
	CPUAvg     float64 `json:"cpuAvg"`
	CPUMax     float64 `json:"cpuMax"`
	Load1Max   float64 `json:"load1Max"`
	MemUsedMax uint64  `json:"memUsedMax"`
}

// AgentEvent /events 事件
type AgentEvent struct {
	TS    int64  `json:"ts"`
	Level string `json:"level"`
	Msg   string `json:"msg"`
}

// WatchStatus /watch/status 单服务
type WatchStatus struct {
	Service   string `json:"service"`
	Runtime   string `json:"runtime"`
	ProcessUp bool   `json:"processUp"`
	HealthUp  bool   `json:"healthUp"`
	IngressUp bool   `json:"ingressUp"`
	IngressOn bool   `json:"ingressOn"`
	Instances int    `json:"instances"`
}

// JarRangePoint /watch/range 点
type JarRangePoint struct {
	TS         int64   `json:"ts"`
	Service    string  `json:"service"`
	PID        int     `json:"pid"`
	Port       int     `json:"port"`
	RSS        uint64  `json:"rss"`
	CPUPercent float64 `json:"cpuPercent"`
	HeapUsed   uint64  `json:"heapUsed"`
	HeapMax    uint64  `json:"heapMax"`
	GCPauseMs  float64 `json:"gcPauseMs"`
	HealthOK   bool    `json:"healthOk"`
}

// WatchRangeResponse /watch/range
type WatchRangeResponse struct {
	Points []JarRangePoint `json:"points"`
}

// WatchEventRow /watch/events
type WatchEventRow struct {
	TS      int64  `json:"ts"`
	Service string `json:"service"`
	Layer   string `json:"layer"`
	Kind    string `json:"kind"`
	Msg     string `json:"msg"`
}

// WatchYAML /admin/watch
type WatchYAML struct {
	YAML string `json:"yaml"`
}

// JavaAppInstance /watch/instances 单 Java 实例
type JavaAppInstance struct {
	Service   string `json:"service"`
	Runtime   string `json:"runtime"`
	PID       int    `json:"pid"`
	Port      int    `json:"port"`
	DeployVer string `json:"deployVer"`
	StartTime string `json:"startTime"`
	Screen    string `json:"screen"`
	JarPath   string `json:"jarPath"`
	HealthUp  bool   `json:"healthUp"`
	ProcessUp bool   `json:"processUp"`
	IngressUp bool   `json:"ingressUp"`
	IngressOn bool   `json:"ingressOn"`
	Status    string `json:"status"`
	Group     string `json:"group"`
}

// AppShutdownReq POST /op/app-shutdown
type AppShutdownReq struct {
	Service string `json:"service"`
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	Screen  string `json:"screen"`
}

// AppShutdownResult POST /op/app-shutdown 响应
type AppShutdownResult struct {
	OK      bool   `json:"ok"`
	Stopped bool   `json:"stopped"`
	Msg     string `json:"msg"`
}

// Status 缓存的 agent 状态（主机列表徽章用）
type Status struct {
	OK           bool      `json:"ok"`
	Version      string    `json:"version"`
	RSSKB        int64     `json:"rssKB"`
	Error        string    `json:"error,omitempty"` // OK=false 时的原因摘要
	NotInstalled bool      `json:"notInstalled,omitempty"`
	CheckedAt    time.Time `json:"checkedAt"`
}

// Client 单个主机的 agent 访问客户端（懒建 HTTP 连接，按主机缓存 token）
type Client struct {
	mgr  *sshd.Manager
	host string
	opt  sshd.ConnectOption

	mu     sync.Mutex
	token  string
	client *http.Client
}

// Pool 按主机缓存 Client
type Pool struct {
	mgr  *sshd.Manager
	opts func(host string) (sshd.ConnectOption, error)

	mu      sync.Mutex
	clients map[string]*Client
	// 状态缓存（避免列表页反复探测）
	statuses map[string]Status
}

func NewPool(mgr *sshd.Manager, opts func(host string) (sshd.ConnectOption, error)) *Pool {
	return &Pool{
		mgr:      mgr,
		opts:     opts,
		clients:  map[string]*Client{},
		statuses: map[string]Status{},
	}
}

// Get 返回（必要时创建）主机的 Client。SSH 配置不可用时返回错误。
func (p *Pool) Get(host string) (*Client, error) {
	p.mu.Lock()
	if c, ok := p.clients[host]; ok {
		p.mu.Unlock()
		return c, nil
	}
	p.mu.Unlock()

	opt, err := p.opts(host)
	if err != nil {
		return nil, err
	}
	return p.GetWithOpt(host, opt)
}

// GetWithOpt 用调用方已备好的连接参数创建/复用 Client（避免重复解析 ssh config）
func (p *Pool) GetWithOpt(host string, opt sshd.ConnectOption) (*Client, error) {
	p.mu.Lock()
	if c, ok := p.clients[host]; ok {
		p.mu.Unlock()
		return c, nil
	}
	p.mu.Unlock()

	c := &Client{mgr: p.mgr, host: host, opt: opt}
	p.mu.Lock()
	if existing, ok := p.clients[host]; ok {
		p.mu.Unlock()
		return existing, nil
	}
	p.clients[host] = c
	p.mu.Unlock()
	return c, nil
}

// Status 探测（或读缓存）agent 状态；force 时跳过缓存。
// 未安装一旦确认，除非 force / InvalidateStatus，不再 SSH 探活。
func (p *Pool) Status(host string, force bool) Status {
	p.mu.Lock()
	if !force {
		if st, ok := p.statuses[host]; ok {
			if st.NotInstalled {
				p.mu.Unlock()
				return st
			}
			if time.Since(st.CheckedAt) < statusCacheTTL {
				p.mu.Unlock()
				return st
			}
		}
	}
	p.mu.Unlock()

	st := p.probe(host)
	p.mu.Lock()
	p.statuses[host] = st
	p.mu.Unlock()
	return st
}

// InvalidateStatus 状态变化后清缓存（如刚安装完）
func (p *Pool) InvalidateStatus(host string) {
	p.mu.Lock()
	delete(p.statuses, host)
	p.mu.Unlock()
}

func (p *Pool) probe(host string) Status {
	c, err := p.Get(host)
	if err != nil {
		return Status{Error: err.Error(), CheckedAt: time.Now()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), fastTimeout)
	defer cancel()
	var h Health
	if err := c.GetJSON(ctx, "/health", &h); err != nil {
		st := Status{Error: err.Error(), CheckedAt: time.Now()}
		if errors.Is(err, ErrAgentUnreachable) || errors.Is(err, ErrNotInstalled) {
			st.NotInstalled = true
			st.Error = ErrNotInstalled.Error()
		}
		return st
	}
	return Status{OK: true, Version: h.Version, RSSKB: h.RSSKB, CheckedAt: time.Now()}
}

// ============ Client ============

// httpClient 懒建：Transport 的 Dial 走 SSH direct-tcpip；
// HTTP keep-alive 会复用隧道连接（等价于常驻一条 channel）。
// MaxIdleConnsPerHost 限制空闲 channel 积压（sshd 单连接默认 MaxSessions=10，
// 积压过多会被 sshd 关闭 channel，复用时表现为 EOF）。
func (c *Client) httpClient() *http.Client {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.client == nil {
		mgr, host, opt := c.mgr, c.host, c.opt
		c.client = &http.Client{
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					// addr 参数忽略：永远走目标主机回环的 agent 端口
					return dialViaSSH(ctx, mgr, host, opt)
				},
				MaxIdleConns:        4,
				MaxIdleConnsPerHost: 2,
				IdleConnTimeout:     60 * time.Second,
			},
		}
	}
	return c.client
}

// transientErr 复用/新建隧道连接时被对端关闭等瞬态网络错误（可安全重试幂等请求）
func transientErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	for _, kw := range []string{"eof", "connection reset", "broken pipe", "use of closed", "connection refused", "timeout"} {
		if strings.Contains(msg, kw) {
			return true
		}
	}
	return false
}

func dialViaSSH(ctx context.Context, mgr *sshd.Manager, host string, opt sshd.ConnectOption) (net.Conn, error) {
	type result struct {
		conn net.Conn
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		conn, err := mgr.Dial(host, opt, AgentPort)
		ch <- result{conn, err}
	}()
	select {
	case r := <-ch:
		if r.err != nil {
			// SSH channel 打开失败多为目标机端口未监听（agent 未装/未跑）
			if strings.Contains(r.err.Error(), "connect failed") {
				return nil, fmt.Errorf("%w: %v", ErrAgentUnreachable, r.err)
			}
			return nil, r.err
		}
		return r.conn, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// token 懒取：经 SSH 读目标机 token 文件（一次性管理命令）；缓存
func (c *Client) getToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	if c.token != "" {
		t := c.token
		c.mu.Unlock()
		return t, nil
	}
	c.mu.Unlock()

	type result struct {
		out []byte
		err error
	}
	ch := make(chan result, 1)
	go func() {
		out, err := c.mgr.Run(c.host, c.opt, "cat /var/lib/spanel-agent/token 2>/dev/null")
		ch <- result{out, err}
	}()
	var r result
	select {
	case r = <-ch:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	tok := strings.TrimSpace(string(r.out))
	if r.err != nil || tok == "" {
		return "", ErrNotInstalled
	}
	c.mu.Lock()
	c.token = tok
	c.mu.Unlock()
	return tok, nil
}

// ResetToken 安装/更换 agent 后调用
func (c *Client) ResetToken() {
	c.mu.Lock()
	c.token = ""
	c.mu.Unlock()
}

// GetJSON GET 并反序列化；slow=true 用于重的按需采集端点。
// 瞬态错误（复用的隧道连接被对端关闭等）自动重试一次——GET 幂等，安全。
func (c *Client) GetJSON(ctx context.Context, path string, out any, slow ...bool) error {
	timeout := fastTimeout
	if len(slow) > 0 && slow[0] {
		timeout = slowTimeout
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		ctx, cancel := context.WithTimeout(ctx, timeout)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://agent"+path, nil)
		if err != nil {
			cancel()
			return err
		}
		tok, err := c.getToken(ctx)
		if err != nil {
			cancel()
			return err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		err = c.do(req, out)
		cancel()
		if err == nil {
			return nil
		}
		lastErr = err
		// agent 未安装/未运行：重试无意义，直接失败
		if errors.Is(err, ErrAgentUnreachable) || errors.Is(err, ErrNotInstalled) {
			return err
		}
		if !transientErr(err) {
			return err
		}
	}
	return lastErr
}

// PostJSON POST JSON body 并反序列化响应
func (c *Client) PostJSON(ctx context.Context, path string, body, out any) error {
	ctx, cancel := context.WithTimeout(ctx, slowTimeout)
	defer cancel()

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(b))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://agent"+path, reader)
	if err != nil {
		return err
	}
	tok, err := c.getToken(ctx)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

func (c *Client) do(req *http.Request, out any) error {
	resp, err := c.httpClient().Do(req)
	if err != nil {
		// 端口拒绝已被 dialViaSSH 归类；其余网络错误统一归为不可达
		if strings.Contains(err.Error(), "connect failed") {
			return fmt.Errorf("%w: %v", ErrAgentUnreachable, err)
		}
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &e) == nil && e.Error != "" {
			return fmt.Errorf("agent: %s", e.Error)
		}
		return fmt.Errorf("agent HTTP %d", resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(body, out)
}
