package terminal

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"

	"diteng-pannel/internal/sshd"
)

// Manager 管理终端会话
// 设计：
//   - 每个 Tab 创建一个 Session（基于 ssh.Client 的独立 channel/PTY）
//   - 复用 sshd.Manager 的连接池，避免重复鉴权
//   - 用 SSH 协议的 RequestPty 申请真正的伪终端，远程 shell 会正常回显输入
//   - stdout 通过 Wails 事件推送给前端
//   - 关闭 Tab → 关 session → 远程 shell 收到 EOF 退出
type Manager struct {
	ctx      context.Context
	sshMgr   *sshd.Manager
	mu       sync.Mutex
	sessions map[string]*Session
}

// Session 一个终端会话，对应一个 SSH channel + PTY
type Session struct {
	ID      string
	Host    string
	session *ssh.Session
	stdin   io.WriteCloser
	cancel  context.CancelFunc // 用于停止输出 goroutine
	mu      sync.Mutex
	closed  bool
}

// NewManager 创建终端管理器
// sshMgr 由 App 注入，用于复用 SSH 连接池
func NewManager(sshMgr *sshd.Manager) *Manager {
	return &Manager{
		sshMgr:   sshMgr,
		sessions: map[string]*Session{},
	}
}

// Init 在 Wails 启动时注入 context（用于发事件）
func (m *Manager) Init(ctx context.Context) {
	m.ctx = ctx
}

// Open 启动一个新终端会话
// host 是目标主机别名，eventName 是前端用来接收输出的 Wails 事件名
// cols/rows 必须是前端 fit 后的真实尺寸；错误尺寸会导致远程 shell 开局乱码（如一串 ]）
func (m *Manager) Open(host string, opt sshd.ConnectOption, eventName string, cols, rows int) (string, error) {
	if m.ctx == nil {
		return "", fmt.Errorf("终端管理器未初始化")
	}
	if m.sshMgr == nil {
		return "", fmt.Errorf("SSH 管理器未注入")
	}
	if cols < 20 {
		cols = 80
	}
	if rows < 5 {
		rows = 24
	}

	// 复用 sshd.Manager 的连接池拿到 *ssh.Client
	client, err := m.sshMgr.GetClient(host, opt)
	if err != nil {
		return "", fmt.Errorf("连接 %s 失败: %w", host, err)
	}

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("创建 SSH 会话失败: %w", err)
	}

	// 申请 PTY：这是终端能正常回显/补全/支持全屏程序的关键
	// ECHO=1 确保远程线路规程回显用户输入（大多数 shell 默认就开，这里显式设置避免被关掉）
	// RequestPty(term, h, w) = rows, cols
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = session.Close()
		return "", fmt.Errorf("请求 PTY 失败: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return "", fmt.Errorf("获取 stdin 失败: %w", err)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return "", fmt.Errorf("获取 stdout 失败: %w", err)
	}

	// 启动远程登录 shell
	if err := session.Shell(); err != nil {
		_ = session.Close()
		return "", fmt.Errorf("启动 shell 失败: %w", err)
	}

	id := uuid.NewString()
	ctx, cancel := context.WithCancel(m.ctx)
	s := &Session{
		ID:      id,
		Host:    host,
		session: session,
		stdin:   stdin,
		cancel:  cancel,
	}

	// 把远程 shell 的输出流推送给前端
	go pumpToEvent(ctx, stdout, eventName, id)

	// 进程结束时通知前端 + 清理
	go func() {
		_ = session.Wait()
		runtime.EventsEmit(m.ctx, eventName+":exit", map[string]any{
			"sessionId": id,
		})
		m.mu.Lock()
		delete(m.sessions, id)
		m.mu.Unlock()
	}()

	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()
	return id, nil
}

// WriteInput 把用户在 xterm 输入的内容发给远程 shell 的 stdin
func (m *Manager) WriteInput(sessionID string, data []byte) error {
	m.mu.Lock()
	s, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("会话 %s 不存在", sessionID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	_, err := s.stdin.Write(data)
	return err
}

// Resize 通知远程 PTY 窗口大小变化（xterm 的 cols/rows）
// 通过 SSH 协议的 window-change 请求，远程 shell 会收到 SIGWINCH
func (m *Manager) Resize(sessionID string, cols, rows int) error {
	m.mu.Lock()
	s, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return s.session.WindowChange(rows, cols)
}

// Close 关闭一个终端会话（关 stdin + 关 session，远程 shell 收到 EOF 退出）
func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	s, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()

	s.cancel()
	_ = s.stdin.Close()
	_ = s.session.Close()
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

// pumpToEvent 把远程 shell 的 stdout 读取并推送到 Wails 事件
// 优化：shell 回显时会产生多次小碎片输出（每个按键可能触发多次 Read），
// 如果每次 Read 都 EventsEmit 会让前端被高频 IPC 事件淹没，导致输入卡顿。
// 这里用「reader + 定时器」双 goroutine 模型：
//   - reader goroutine 持续读 stdout，把数据送入 readCh
//   - 主循环 select：有新数据就攒进 batch；12ms 没有新数据就把攒的批量发出去
// 这样碎片化输出被合并，IPC 频率从「每 Read 一次」降到「每 12ms 窗口一次」
func pumpToEvent(ctx context.Context, r io.Reader, eventName, sessionID string) {
	readCh := make(chan readResult, 1)
	// reader goroutine：阻塞读 stdout，把结果送入 channel
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				select {
				case readCh <- readResult{data: data, err: err}:
				case <-ctx.Done():
					return
				}
			}
			if err != nil {
				select {
				case readCh <- readResult{err: err}:
				case <-ctx.Done():
				}
				return
			}
		}
	}()

	var batch []byte

	flush := func() {
		if len(batch) == 0 {
			return
		}
		data := make([]byte, len(batch))
		copy(data, batch)
		runtime.EventsEmit(ctx, eventName, map[string]any{
			"data": string(data),
		})
		batch = batch[:0]
	}

	// 12ms 刷新窗口定时器：把碎片化输出合并成更少的事件
	flushTimer := time.NewTimer(12 * time.Millisecond)
	if !flushTimer.Stop() {
		select {
		case <-flushTimer.C:
		default:
		}
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case res := <-readCh:
			if len(res.data) > 0 {
				batch = append(batch, res.data...)
				// 攒够 16KB 立刻发（大输出如 cat 大文件）
				if len(batch) >= 16*1024 {
					if !flushTimer.Stop() {
						select { case <-flushTimer.C: default: }
					}
					flush()
					continue
				}
				// 有新数据就（重新）启动 12ms 窗口
				if !flushTimer.Stop() {
					select { case <-flushTimer.C: default: }
				}
				flushTimer.Reset(12 * time.Millisecond)
			}
			if res.err != nil {
				flush()
				return
			}
		case <-flushTimer.C:
			flush()
			flushTimer.Reset(12 * time.Millisecond)
		}
	}
}

// readResult 是 reader goroutine 的返回
type readResult struct {
	data []byte
	err  error
}
