package sshd

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// RunOptions 单次命令执行的可选项
type RunOptions struct {
	Timeout time.Duration // 默认 30s
	Stdin   string        // 非空时作为远端命令的标准输入（如 sudo -S 的密码）
}

// sudoDeniedMarkers sudo 无法提权时的典型输出（统一换成可操作的提示）
var sudoDeniedMarkers = []string{
	"a password is required",
	"no password was provided",
	"incorrect password",
	"sorry, try again",
	"is not in the sudoers",
	"may not run sudo",
	"a terminal is required",
	"sudo: command not found",
	"sudo: not found",
}

// shellQuote 把任意文本包成 POSIX sh 单引号字面量
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

// rootWrap 生成一次往返完成的提权命令：root 直接跑；免密 sudo 用 -n；否则 sudo -S 从 stdin 读密码
func rootWrap(script string) string {
	q := shellQuote(script)
	return `if [ "$(id -u)" = 0 ]; then sh -c ` + q +
		`; elif sudo -n true 2>/dev/null; then sudo -n sh -c ` + q +
		`; else sudo -S -p '' sh -c ` + q + `; fi`
}

func isSudoDenied(out string) bool {
	lower := strings.ToLower(out)
	for _, marker := range sudoDeniedMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// ErrNoRoot 登录用户既不是 root，也无法通过 sudo 提权
var ErrNoRoot = errors.New("无 root 权限")

// RunAsRoot 以 root 身份执行脚本：已是 root 直接执行；配置了免密 sudo 用 sudo -n；
// 否则用 opt.Password 经 stdin 走 sudo -S（密码不出现在远端命令行）。
// 都不可用时返回包装了 ErrNoRoot 的错误。
func (m *Manager) RunAsRoot(host string, opt ConnectOption, script string, runOpts ...RunOptions) ([]byte, error) {
	ro := RunOptions{}
	if len(runOpts) > 0 {
		ro = runOpts[0]
	}
	if opt.Password != "" {
		ro.Stdin = opt.Password + "\n"
	}
	out, err := m.Run(host, opt, rootWrap(script), ro)
	if err != nil && isSudoDenied(string(out)) {
		return out, fmt.Errorf("%w：当前用户 %s 无法提权，请为其配置免密 sudo（NOPASSWD），或在主机设置里填写该用户密码，或改用 root 登录", ErrNoRoot, opt.User)
	}
	return out, err
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
	if len(runOpts) > 0 && runOpts[0].Stdin != "" {
		session.Stdin = strings.NewReader(runOpts[0].Stdin)
	}

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
