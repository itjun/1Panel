package sshd

import (
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/ssh"
)

// RunOptions 单次命令执行的可选项
type RunOptions struct {
	Timeout time.Duration // 默认 30s
}

// errSessionCreate 标识 NewSession 失败（连接级错误），Run 据此判断是否需要重建连接
var errSessionCreate = errors.New("session create failed")

// Run 在指定 host 上执行一条命令，返回 stdout+stderr 合并输出
// 如果连接不存在会自动建立。连接级失败时自动重建并重试一次（不 Close 旧连接，
// 以保护该主机上正在使用的终端 session）。
func (m *Manager) Run(host string, opt ConnectOption, cmd string, runOpts ...RunOptions) ([]byte, error) {
	client, err := m.Get(host, opt)
	if err != nil {
		return nil, err
	}
	out, err := runWithClient(client, cmd, runOpts...)
	if err == nil {
		return out, nil
	}
	// 只在 session 创建失败（连接级错误）时重建重试；命令超时/执行失败不重试
	if !errors.Is(err, errSessionCreate) {
		return out, err
	}
	// 从缓存移除旧连接（不 Close，保护终端 session），重建后重试一次
	m.mu.Lock()
	if e, ok := m.conns[host]; ok && e.client == client {
		delete(m.conns, host)
	}
	m.mu.Unlock()
	client2, err2 := m.Get(host, opt)
	if err2 != nil {
		return nil, err // 返回原始错误
	}
	return runWithClient(client2, cmd, runOpts...)
}

// RunWithClient 用一个已建立的连接跑命令（避免重复获取连接）
func runWithClient(client *ssh.Client, cmd string, runOpts ...RunOptions) ([]byte, error) {
	timeout := 30 * time.Second
	if len(runOpts) > 0 && runOpts[0].Timeout > 0 {
		timeout = runOpts[0].Timeout
	}

	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errSessionCreate, err)
	}
	defer session.Close()

	done := make(chan struct{})
	var out []byte
	var runErr error
	go func() {
		defer close(done)
		out, runErr = session.CombinedOutput(cmd)
	}()
	select {
	case <-done:
		return out, runErr
	case <-time.After(timeout):
		_ = session.Signal(ssh.SIGKILL)
		return nil, fmt.Errorf("命令执行超时（%s）: %s", timeout, cmd)
	}
}
