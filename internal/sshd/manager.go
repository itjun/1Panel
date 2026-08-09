package sshd

import (
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Manager 维护每个 Host 一个长连接 ssh.Client，按需开 Session
// 设计原则：
//   - 一个 host → 一个 ssh.Client（TCP 复用）
//   - 同一 host 上跑多条命令各自开 Session
//   - 连接失败/断开时自动清理，下次重新建立
type Manager struct {
	mu    sync.Mutex
	conns map[string]*clientEntry // host -> 连接
}

type clientEntry struct {
	client  *ssh.Client
	created time.Time
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
	Password     string // 与 IdentityFile 二选一
}

// Get 返回一个 host 对应的 ssh.Client；若不存在则建立
// host 参数作为缓存 key，应该唯一标识一个目标（通常是 ssh config 里的 Host 别名）
func (m *Manager) Get(host string, opt ConnectOption) (*ssh.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 复用已有连接
	if entry, ok := m.conns[host]; ok {
		// 用一个 Session 测试连接是否还活着
		s, err := entry.client.NewSession()
		if err == nil {
			_ = s.Close()
			return entry.client, nil
		}
		// 连接死了，清理后重建
		_ = entry.client.Close()
		delete(m.conns, host)
	}

	client, err := m.dial(opt)
	if err != nil {
		return nil, err
	}
	m.conns[host] = &clientEntry{client: client, created: time.Now()}
	return client, nil
}

// Close 释放指定 host 的连接
func (m *Manager) Close(host string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if entry, ok := m.conns[host]; ok {
		_ = entry.client.Close()
		delete(m.conns, host)
	}
}

// CloseAll 释放所有连接（应用退出时调用）
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, entry := range m.conns {
		_ = entry.client.Close()
	}
	m.conns = map[string]*clientEntry{}
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
	// 2. 密码备选（用于首次 ssh-copy-id 场景）
	if opt.Password != "" {
		auths = append(auths, ssh.Password(opt.Password))
	}
	if len(auths) == 0 {
		return nil, fmt.Errorf("没有可用的认证方式（密钥或密码）")
	}

	config := &ssh.ClientConfig{
		User:            opt.User,
		Auth:            auths,
		Timeout:         10 * time.Second,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // 内部工具，不做 host key 校验
	}
	addr := net.JoinHostPort(opt.HostName, port)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, fmt.Errorf("连接 %s 失败: %w", addr, err)
	}
	return client, nil
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
