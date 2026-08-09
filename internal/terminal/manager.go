package terminal

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Manager 管理终端会话
// 设计：
//   - 每个 Tab 创建一个 Session（独立 ssh 进程）
//   - stdin 通过 WriteInput 发送给 ssh 进程
//   - stdout/stderr 通过 Wails 事件推送给前端
//   - 关闭 Tab → Kill 进程 → 清理 Session
type Manager struct {
	ctx      context.Context
	mu       sync.Mutex
	sessions map[string]*Session
}

type Session struct {
	ID       string
	Host     string
	Cmd      *exec.Cmd
	Stdin    io.WriteCloser
	Done     chan struct{}
}

func NewManager() *Manager {
	return &Manager{sessions: map[string]*Session{}}
}

// Init 在 Wails 启动时注入 context（用于发事件）
func (m *Manager) Init(ctx context.Context) {
	m.ctx = ctx
}

// Open 启动一个新终端会话
// eventName 是前端用来接收输出的 Wails 事件名（每会话一个，避免互相串扰）
func (m *Manager) Open(host string, eventName string) (string, error) {
	if m.ctx == nil {
		return "", fmt.Errorf("终端管理器未初始化")
	}
	// 直接调系统 ssh；IdentityFile/ProxyJump 等配置完全交给 ~/.ssh/config
	cmd := exec.Command("ssh", "-tt", host)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	// 设置进程组，便于优雅 kill 整个 ssh 及其子进程
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("创建 stdin 管道失败: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("创建 stdout 管道失败: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("创建 stderr 管道失败: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("启动 ssh 失败: %w", err)
	}

	id := uuid.NewString()
	session := &Session{
		ID:    id,
		Host:  host,
		Cmd:   cmd,
		Stdin: stdin,
		Done:  make(chan struct{}),
	}

	// 把 stdout/stderr 流推送给前端
	go pumpToEvent(m.ctx, stdout, eventName, session.Done)
	go pumpToEvent(m.ctx, stderr, eventName, session.Done)

	// 进程结束时通知前端
	go func() {
		_ = cmd.Wait()
		close(session.Done)
		runtime.EventsEmit(m.ctx, eventName+":exit", map[string]any{
			"sessionId": id,
		})
		m.mu.Lock()
		delete(m.sessions, id)
		m.mu.Unlock()
	}()

	m.mu.Lock()
	m.sessions[id] = session
	m.mu.Unlock()
	return id, nil
}

// WriteInput 把用户在 xterm 输入的内容发给 ssh 进程的 stdin
func (m *Manager) WriteInput(sessionID string, data []byte) error {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("会话 %s 不存在", sessionID)
	}
	_, err := session.Stdin.Write(data)
	return err
}

// Resize 通知 ssh 进程窗口大小变化（xterm 的 cols/rows）
func (m *Manager) Resize(sessionID string, cols, rows int) error {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	// 给 ssh 进程组发 SIGWINCH（系统 ssh 不接受外部窗口变更信号，
	// 这里通过 "-tt" + 内部默认大小（80x24）已经够用；精确 resize 留待 v2 优化）
	_ = session
	_ = cols
	_ = rows
	return nil
}

// Close 关闭一个终端会话（发送 EOF + 杀进程）
func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	_ = session.Stdin.Close()
	if session.Cmd.Process != nil {
		_ = syscall.Kill(-session.Cmd.Process.Pid, syscall.SIGTERM)
	}
	return nil
}

// CloseAll 应用退出时调用
func (m *Manager) CloseAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Close(id)
	}
}

// pumpToEvent 把 reader 的输出推送到 Wails 事件
func pumpToEvent(ctx context.Context, r io.Reader, eventName string, done <-chan struct{}) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			runtime.EventsEmit(ctx, eventName, map[string]any{
				"data": string(data),
			})
		}
		if err != nil {
			return
		}
		select {
		case <-done:
			return
		default:
		}
	}
}
