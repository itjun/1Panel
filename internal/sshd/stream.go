package sshd

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/ssh"
)

// RunStream 在远端执行长命令，stdout 每读到一行就回调 onLine（不含换行）；stderr 收集后随错误返回。
// ctx 取消时先发 SIGTERM 再关闭 session（OpenSSH 服务端常忽略 signal，关闭通道会让远端进程收到 SIGHUP）。
// 复用 Manager 的长连接，但每次独占一个 session，不影响同主机的终端与采集。
func (m *Manager) RunStream(ctx context.Context, host string, opt ConnectOption, cmd string, onLine func(string)) error {
	client, err := m.Get(host, opt)
	if err != nil {
		return err
	}
	session, err := client.NewSession()
	if err != nil {
		m.mu.Lock()
		if e, ok := m.conns[host]; ok && e.client == client {
			delete(m.conns, host)
		}
		m.mu.Unlock()
		client, err = m.Get(host, opt)
		if err != nil {
			return err
		}
		if session, err = client.NewSession(); err != nil {
			return fmt.Errorf("创建 SSH 会话失败: %w", err)
		}
	}
	defer session.Close()

	stdout, err := session.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr strings.Builder
	session.Stderr = &limitedWriter{w: &stderr, left: 16 * 1024}
	if err := session.Start(cmd); err != nil {
		return err
	}

	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			_ = session.Signal(ssh.SIGTERM)
			_ = session.Close()
		case <-stop:
		}
	}()

	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		onLine(sc.Text())
	}
	waitErr := session.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return fmt.Errorf("%w: %s", waitErr, msg)
		}
		return waitErr
	}
	return nil
}

type limitedWriter struct {
	w    io.Writer
	left int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	n := len(p)
	if l.left > 0 {
		if len(p) > l.left {
			p = p[:l.left]
		}
		l.left -= len(p)
		_, _ = l.w.Write(p)
	}
	return n, nil
}
