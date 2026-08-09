package sshd

import (
	"fmt"
	"time"

	"golang.org/x/crypto/ssh"
)

// RunOptions 单次命令执行的可选项
type RunOptions struct {
	Timeout time.Duration // 默认 30s
}

// Run 在指定 host 上执行一条命令，返回 stdout+stderr 合并输出
// 如果连接不存在会自动建立
func (m *Manager) Run(host string, opt ConnectOption, cmd string, runOpts ...RunOptions) ([]byte, error) {
	client, err := m.Get(host, opt)
	if err != nil {
		return nil, err
	}
	return runWithClient(client, cmd, runOpts...)
}

// RunWithClient 用一个已建立的连接跑命令（避免重复获取连接）
func runWithClient(client *ssh.Client, cmd string, runOpts ...RunOptions) ([]byte, error) {
	timeout := 30 * time.Second
	if len(runOpts) > 0 && runOpts[0].Timeout > 0 {
		timeout = runOpts[0].Timeout
	}

	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("创建 session 失败: %w", err)
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
