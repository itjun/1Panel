package sshd

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// 连接超时：覆盖 TCP 建连 + SSH 握手/认证全过程
// 注意：ssh.ClientConfig.Timeout 只作用于 TCP Dial，不覆盖握手阶段
const (
	tcpConnectTimeout = 10 * time.Second
	handshakeTimeout  = 15 * time.Second // 含认证；超时必须失败，避免拖死全局锁
)

// keepalive 心跳：从源头减少空闲长连接被防火墙/服务器掐断
const (
	keepaliveInterval  = 15 * time.Second // 心跳间隔
	keepaliveTimeout   = 5 * time.Second  // 单次心跳发送的超时
	keepaliveMaxMissed = 3                // 连续无响应次数，超过判死关闭连接
)

// errKeepaliveTimeout 标识单次心跳超时
var errKeepaliveTimeout = errors.New("keepalive timeout")

// Manager 维护每个 Host 一个长连接 ssh.Client，按需开 Session
// 设计原则：
//   - 一个 host → 一个 ssh.Client（TCP 复用）
//   - 同一 host 上跑多条命令各自开 Session
//   - 连接失败/断开时自动清理，下次重新建立
//   - dial 不持锁：握手可能很慢/挂死，绝不能阻塞其它 host
type Manager struct {
	mu    sync.Mutex
	conns map[string]*clientEntry // host -> 连接
}

type clientEntry struct {
	client  *ssh.Client
	created time.Time
	cancel  context.CancelFunc // 停止 keepalive 心跳
}

func NewManager() *Manager {
	return &Manager{conns: map[string]*clientEntry{}}
}

// ConnectOption 建立连接的可选项
type ConnectOption struct {
	Host         string // ssh config 里的 Host 别名（或直接 IP）
	HostName     string // 实际 IP/域名
	User         string
	Port         string // 留空则 22
	IdentityFile string
	Password     string // 与 IdentityFile 二选一；也可同时给（密钥优先）
}

// Get 返回一个 host 对应的 ssh.Client；若不存在则建立
// host 参数作为缓存 key，应该唯一标识一个目标（通常是 ssh config 里的 Host 别名）
//
// 注意：不做 NewSession 健康检查。之前每次 Get 都用 NewSession 测试连接存活，
// 失败就 Close 整个 client —— 这会断开该主机上正在使用的终端 session（PTY）。
// 连接存活性改由 Run 的重试机制兜底（仅连接级失败时重建，不 Close 旧连接）。
func (m *Manager) Get(host string, opt ConnectOption) (*ssh.Client, error) {
	// 快路径：复用已有连接
	m.mu.Lock()
	if entry, ok := m.conns[host]; ok {
		client := entry.client
		m.mu.Unlock()
		return client, nil
	}
	m.mu.Unlock()

	// 2) dial 不持锁：握手卡死时不应阻塞其它 host 的 Get/Close
	client, err := m.dial(opt)
	if err != nil {
		return nil, err
	}

	// 3) 写回缓存；若并发已有人先连上，丢弃本次连接、复用已有
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	if entry, ok := m.conns[host]; ok {
		existing := entry.client
		m.mu.Unlock()
		cancel()
		_ = client.Close()
		return existing, nil
	}
	m.conns[host] = &clientEntry{client: client, created: time.Now(), cancel: cancel}
	m.mu.Unlock()
	go m.keepaliveLoop(host, client, ctx)
	return client, nil
}

// GetClient 是 Get 的公开别名，供 sftp 等第三方包直接复用 *ssh.Client
func (m *Manager) GetClient(host string, opt ConnectOption) (*ssh.Client, error) {
	return m.Get(host, opt)
}

// DialNew 建立一条独立 SSH 连接（不进连接池、不 keepalive）。
// 供终端 PTY 等需要与面板采集隔离的长会话使用，避免共享连接时互相反压。
// 调用方负责在会话结束时 Close 释放连接。
func (m *Manager) DialNew(opt ConnectOption) (*ssh.Client, error) {
	return m.dial(opt)
}

// Dial 经 host 的 SSH 连接建立 direct-tcpip 通道，返回等效的 TCP 连接。
// 与本地端口转发（ssh -L）等价，但不开本地端口、复用连接池与 keepalive。
// 用于访问目标主机上的 agent（127.0.0.1:39190）等回环服务。
//
// 错误分级（与 Run 的 errSessionCreate 原则一致，只对连接级故障重建）：
//   - "connect failed"：目标端口未监听被 sshd 拒绝，SSH 连接本身健康——
//     直接返回错误，绝不能删缓存重建（否则健康连接被反复丢弃泄漏，
//     keepalive 永不失败导致连接与 goroutine 无界累积）
//   - 其余错误（网络断/对端 sshd 死）：连接级故障，重建后重试一次
func (m *Manager) Dial(host string, opt ConnectOption, addr string) (net.Conn, error) {
	client, err := m.Get(host, opt)
	if err != nil {
		return nil, err
	}
	conn, err := client.Dial("tcp", addr)
	if err == nil {
		return conn, nil
	}
	if strings.Contains(err.Error(), "connect failed") {
		return nil, err
	}
	// 连接级失败：从缓存移除（不 Close，保护终端 session），重建后重试一次
	m.mu.Lock()
	if e, ok := m.conns[host]; ok && e.client == client {
		delete(m.conns, host)
	}
	m.mu.Unlock()
	client2, err2 := m.Get(host, opt)
	if err2 != nil {
		return nil, err
	}
	return client2.Dial("tcp", addr)
}

// Close 释放指定 host 的连接
func (m *Manager) Close(host string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if entry, ok := m.conns[host]; ok {
		entry.cancel()
		_ = entry.client.Close()
		delete(m.conns, host)
	}
}

// CloseAll 释放所有连接（应用退出时调用）
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, entry := range m.conns {
		entry.cancel()
		_ = entry.client.Close()
	}
	m.conns = map[string]*clientEntry{}
}

// keepaliveLoop 周期发心跳保活；连续无响应超过阈值则判死并关闭连接，
// 同时从缓存移除该连接，使下一次 Get 重新建连。
func (m *Manager) keepaliveLoop(host string, client *ssh.Client, ctx context.Context) {
	ticker := time.NewTicker(keepaliveInterval)
	defer ticker.Stop()
	missed := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := sendKeepalive(client); err != nil {
				missed++
				if missed >= keepaliveMaxMissed {
					m.mu.Lock()
					if e, ok := m.conns[host]; ok && e.client == client {
						delete(m.conns, host)
					}
					m.mu.Unlock()
					_ = client.Close()
					return
				}
			} else {
				missed = 0
			}
		}
	}
}

// sendKeepalive 发一次 keepalive@openssh.com 请求；带超时，避免半开连接永久阻塞。
func sendKeepalive(client *ssh.Client) error {
	done := make(chan error, 1)
	go func() {
		_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
		done <- err
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(keepaliveTimeout):
		return errKeepaliveTimeout
	}
}

func (m *Manager) dial(opt ConnectOption) (*ssh.Client, error) {
	port := opt.Port
	if port == "" {
		port = "22"
	}
	if opt.HostName == "" {
		return nil, fmt.Errorf("HostName 不能为空")
	}
	if opt.User == "" {
		return nil, fmt.Errorf("User 不能为空")
	}

	var auths []ssh.AuthMethod
	// 1. 密钥优先
	if opt.IdentityFile != "" {
		if signer := loadSigner(opt.IdentityFile); signer != nil {
			auths = append(auths, ssh.PublicKeys(signer))
		}
	}
	// 2. 密码（password + keyboard-interactive，兼容只开后者的服务器）
	if opt.Password != "" {
		pass := opt.Password
		auths = append(auths, ssh.Password(pass))
		auths = append(auths, ssh.KeyboardInteractive(
			func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				_ = user
				_ = instruction
				_ = echos
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = pass
				}
				return answers, nil
			},
		))
	}
	if len(auths) == 0 {
		return nil, fmt.Errorf("没有可用的认证方式（密钥或密码）")
	}

	config := &ssh.ClientConfig{
		User:            opt.User,
		Auth:            auths,
		Timeout:         tcpConnectTimeout,          // 仅 TCP；完整握手见下方 SetDeadline
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // 内部工具，不做 host key 校验
	}
	addr := net.JoinHostPort(opt.HostName, port)

	raw, err := dialTCPOnce(addr)
	if err != nil && shouldRetryLAN(addr, err) {
		TriggerLocalNetworkPrivacy()
		raw, err = retryDialTCP(addr)
	}
	if err != nil {
		return nil, wrapDialErr(addr, err)
	}
	_ = raw.SetDeadline(time.Now().Add(handshakeTimeout))

	cc, chans, reqs, err := ssh.NewClientConn(raw, addr, config)
	if err != nil {
		_ = raw.Close()
		return nil, fmt.Errorf("连接 %s 失败: %w", addr, err)
	}
	// 握手成功后清掉 deadline，长连接后续由业务超时控制
	_ = raw.SetDeadline(time.Time{})

	return ssh.NewClient(cc, chans, reqs), nil
}

func loadSigner(path string) ssh.Signer {
	if strings.HasPrefix(path, "~/") {
		home, _ := os.UserHomeDir()
		path = home + path[1:]
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	signer, err := ssh.ParsePrivateKey(b)
	if err != nil {
		return nil
	}
	return signer
}
