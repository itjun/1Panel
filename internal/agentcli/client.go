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

	"diteng-pannel/internal/agentapi"
	"diteng-pannel/internal/sshd"
)

// AgentPort agent 默认端口（后续可随主机配置扩展）
const AgentPort = "127.0.0.1:39190"

// 请求超时：概览轮询等读库端点要快；按需采集（包列表等）允许更久
const (
	fastTimeout    = 5 * time.Second
	slowTimeout    = 45 * time.Second
	longTimeout    = 120 * time.Second
	statusCacheTTL = 30 * time.Second
)

// ErrAgentUnreachable agent 未安装或未运行（端口拒绝/不通）
var ErrAgentUnreachable = errors.New("agent 不可达（未安装或未运行）")

// ErrNotInstalled token 文件不存在，视为未安装
var ErrNotInstalled = errors.New("agent 未安装")

// HTTP JSON 契约类型定义在 internal/agentapi；别名保持 Wails 绑定名不变。

type Health = agentapi.Health
type HostInfo = agentapi.HostInfo
type CurrentPoint = agentapi.CurrentPoint
type CurrentResponse = agentapi.CurrentResponse
type RangePoint = agentapi.RangePoint
type RangeResponse = agentapi.RangeResponse
type SummaryRange = agentapi.SummaryRange
type AgentEvent = agentapi.AgentEvent
type WatchStatus = agentapi.WatchStatus
type JarRangePoint = agentapi.JarRangePoint
type WatchRangeResponse = agentapi.WatchRangeResponse
type WatchEventRow = agentapi.WatchEvent
type WatchYAML = agentapi.WatchYAML
type JavaAppInstance = agentapi.JavaAppInstance
type AppShutdownReq = agentapi.AppShutdownReq
type AppShutdownResult = agentapi.AppShutdownResult
type CertBrief = agentapi.CertBrief
type CertCheckSnapshot = agentapi.CertCheckSnapshot

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
	// 最近一次补拉起时间（节流）
	healedAt map[string]time.Time
}

func NewPool(mgr *sshd.Manager, opts func(host string) (sshd.ConnectOption, error)) *Pool {
	return &Pool{
		mgr:      mgr,
		opts:     opts,
		clients:  map[string]*Client{},
		statuses: map[string]Status{},
		healedAt: map[string]time.Time{},
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
	err = c.GetJSON(ctx, "/health", &h)
	if errors.Is(err, ErrAgentUnreachable) && p.tryHeal(host, c) {
		rctx, rcancel := context.WithTimeout(context.Background(), fastTimeout)
		err = c.GetJSON(rctx, "/health", &h)
		rcancel()
	}
	if err != nil {
		st := Status{Error: err.Error(), CheckedAt: time.Now()}
		if errors.Is(err, ErrAgentUnreachable) || errors.Is(err, ErrNotInstalled) {
			st.NotInstalled = true
			st.Error = ErrNotInstalled.Error()
		}
		return st
	}
	return Status{OK: true, Version: h.Version, RSSKB: h.RSSKB, CheckedAt: time.Now()}
}

// healInterval 同一主机补拉起的最小间隔，避免 agent 起不来时反复 SSH 提权
const healInterval = 2 * time.Minute

// healCmd 已装 ctl 时补拉起（未在跑才启动）；没有 ctl 输出 missing
const healCmd = `if [ -x /usr/local/bin/spanel-agent-ctl ]; then /usr/local/bin/spanel-agent-ctl ensure; else echo missing; fi`

// tryHeal agent 不可达时经 SSH 执行 ctl ensure（按主机节流）；真正拉起了才返回 true。
// 覆盖无 systemd 主机容器重启、守护循环被杀等场景。
func (p *Pool) tryHeal(host string, c *Client) bool {
	p.mu.Lock()
	if last, ok := p.healedAt[host]; ok && time.Since(last) < healInterval {
		p.mu.Unlock()
		return false
	}
	p.healedAt[host] = time.Now()
	p.mu.Unlock()

	out, err := p.mgr.RunAsRoot(host, c.opt, healCmd, sshd.RunOptions{Timeout: 20 * time.Second})
	if err != nil || lastLine(string(out)) != "started" {
		return false
	}
	c.ResetToken()
	time.Sleep(2 * time.Second)
	return true
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
		// 数据目录为 root 700，普通用户需经 sudo 读取
		out, err := c.mgr.RunAsRoot(c.host, c.opt, "cat /var/lib/spanel-agent/token 2>/dev/null")
		ch <- result{out, err}
	}()
	var r result
	select {
	case r = <-ch:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if errors.Is(r.err, sshd.ErrNoRoot) {
		return "", r.err
	}
	tok := lastLine(string(r.out))
	if r.err != nil || tok == "" {
		return "", ErrNotInstalled
	}
	c.mu.Lock()
	c.token = tok
	c.mu.Unlock()
	return tok, nil
}

// lastLine 取最后一个非空行：sudo 首次使用可能先输出提示语，token 总在末尾
func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return ""
}

// ResetToken 安装/更换 agent 后调用：清 token，并丢掉可能连着旧进程的空闲连接。
func (c *Client) ResetToken() {
	c.mu.Lock()
	c.token = ""
	if c.client != nil {
		c.client.CloseIdleConnections()
	}
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
	return c.PostJSONTimeout(ctx, path, body, out, slowTimeout)
}

// PostJSONTimeout 与 PostJSON 相同，可指定超时（apt-get update 等）。
func (c *Client) PostJSONTimeout(ctx context.Context, path string, body, out any, d time.Duration) error {
	if d <= 0 {
		d = slowTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, d)
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
