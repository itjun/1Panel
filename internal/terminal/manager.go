package terminal

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"

	"diteng-pannel/internal/sshd"
)

// EmitFunc 把事件推送给前端（由上层注入，Events 模式下使用）
// 返回是否被取消（语义与 wails v3 application.Event.Emit 对齐）
type EmitFunc func(eventName string, data ...any) bool

// Manager 管理终端会话
// 设计：
//   - 每个 Tab 创建一个 Session，每个 Session 用独立 SSH 连接（不复用连接池），
//     与面板采集的 agent 隧道隔离，避免共享连接互相反压导致输入卡顿
//   - 用 SSH 协议的 RequestPty 申请真正的伪终端，远程 shell 会正常回显输入
//   - 数据通道走 Wails 事件推送（异步非阻塞，见 pumpToEvent）
//   - 关闭 Tab → 关 session + 关独立连接 → 远程 shell 收到 EOF 退出
type Manager struct {
	ctx      context.Context
	sshMgr   *sshd.Manager
	mu       sync.Mutex
	sessions map[string]*Session

	emit EmitFunc // 事件推送（注入，可空则跳过）
}

// Session 一个终端会话，对应一条独立 SSH 连接上的 channel + PTY
type Session struct {
	ID              string
	Host            string
	client          *ssh.Client // 会话独占的 SSH 连接，Close 时释放
	session         *ssh.Session
	stdin           io.WriteCloser
	cancel          context.CancelFunc // 用于停止输出 goroutine
	keepaliveCancel context.CancelFunc // 停止独立连接上的激进心跳
	mu              sync.Mutex
	closed          bool
}


// NewManager 创建终端管理器
// sshMgr 由 App 注入，用于复用 SSH 连接池
func NewManager(sshMgr *sshd.Manager) *Manager {
	return &Manager{
		sshMgr:   sshMgr,
		sessions: map[string]*Session{},
	}
}

// Init 设置事件推送函数（Events 模式用）与基础 context
// 由上层在应用启动时注入
func (m *Manager) Init(ctx context.Context, emit EmitFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	m.ctx = ctx
	m.emit = emit
}

// openShell 建立独立 SSH 连接、申请 PTY 并启动远程登录 shell。
// 每个终端会话独占一条连接，与面板采集隔离，避免共享连接互相反压导致输入卡顿。
// cols/rows 必须是前端 fit 后的真实尺寸；错误尺寸会导致远程 shell 开局乱码（如一串 ]）
// 返回的 keepaliveCancel 用于会话结束时停止心跳。
func (m *Manager) openShell(host string, opt sshd.ConnectOption, cols, rows int) (*ssh.Client, *ssh.Session, io.WriteCloser, io.Reader, context.CancelFunc, error) {
	if m.ctx == nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("终端管理器未初始化")
	}
	if m.sshMgr == nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("SSH 管理器未注入")
	}
	if cols < 20 {
		cols = 80
	}
	if rows < 5 {
		rows = 24
	}

	// 独立连接 + 激进心跳：尽快发现网络断开，推动前端自动重连
	client, keepaliveCancel, err := m.sshMgr.DialNewKeepalive(opt)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("连接 %s 失败: %w", host, err)
	}
	// 后续任一失败都关掉独立连接，避免泄漏
	closeOnErr := func() {
		keepaliveCancel()
		_ = client.Close()
	}

	session, err := client.NewSession()
	if err != nil {
		closeOnErr()
		return nil, nil, nil, nil, nil, fmt.Errorf("创建 SSH 会话失败: %w", err)
	}

	// 申请 PTY：这是终端能正常回显/补全/支持全屏程序的关键
	// ECHO=1 确保远程线路规程回显用户输入（大多数 shell 默认就开，这里显式设置避免被关掉）
	// RequestPty(term, h, w) = rows, cols
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 115200,
		ssh.TTY_OP_OSPEED: 115200,
	}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = session.Close()
		closeOnErr()
		return nil, nil, nil, nil, nil, fmt.Errorf("请求 PTY 失败: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		closeOnErr()
		return nil, nil, nil, nil, nil, fmt.Errorf("获取 stdin 失败: %w", err)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		closeOnErr()
		return nil, nil, nil, nil, nil, fmt.Errorf("获取 stdout 失败: %w", err)
	}

	// 启动远程登录 shell
	if err := session.Shell(); err != nil {
		_ = session.Close()
		closeOnErr()
		return nil, nil, nil, nil, nil, fmt.Errorf("启动 shell 失败: %w", err)
	}
	return client, session, stdin, stdout, keepaliveCancel, nil
}

// Open 启动一个终端会话（独立 SSH 连接 + Wails 事件推送）
// host 是目标主机别名，eventName 是前端用来接收输出的 Wails 事件名
func (m *Manager) Open(host string, opt sshd.ConnectOption, eventName string, cols, rows int) (string, error) {
	client, session, stdin, stdout, keepaliveCancel, err := m.openShell(host, opt, cols, rows)
	if err != nil {
		return "", err
	}

	id := uuid.NewString()
	parentCtx := m.ctx
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	ctx, cancel := context.WithCancel(parentCtx)
	s := &Session{
		ID:              id,
		Host:            host,
		client:          client,
		session:         session,
		stdin:           stdin,
		cancel:          cancel,
		keepaliveCancel: keepaliveCancel,
	}

	// 把远程 shell 的输出流推送给前端
	go pumpToEvent(ctx, stdout, eventName, id, m.emit)

	// 进程结束时通知前端 + 清理。
	// 区分断开原因：正常退出（exit 命令）reason=exit，异常断开（网络等）reason=error，
	// 前端据此决定是否自动重连。
	go func() {
		err := session.Wait()
		reason := "exit"
		if err != nil {
			if _, ok := err.(*ssh.ExitError); !ok {
				reason = "error"
			}
		}
		// Wait 返回后必须释放独立连接与心跳，避免泄漏；与手动 Close 共用 release
		s.release()
		if m.emit != nil {
			m.emit(eventName+":exit", map[string]any{
				"sessionId": id,
				"reason":    reason,
			})
		}
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

// release 幂等释放：停心跳、停输出泵、关 stdin/session/独立连接。
func (s *Session) release() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.mu.Unlock()

	if s.keepaliveCancel != nil {
		s.keepaliveCancel()
	}
	if s.cancel != nil {
		s.cancel()
	}
	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if s.session != nil {
		_ = s.session.Close()
	}
	if s.client != nil {
		_ = s.client.Close()
	}
}

// Close 关闭一个终端会话（关 stdin + 关 session + 关独立连接，远程 shell 收到 EOF 退出）
func (m *Manager) Close(sessionID string) error {
	m.mu.Lock()
	s, ok := m.sessions[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	s.release()
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
//
// 延迟与吞吐的平衡（leading-edge 合并）：
//   - 交互打字：回显是「空闲后到来的一小段数据」，必须立即发，任何合并窗口都是纯延迟；
//   - 流式输出（cat 大文件）：读取会连续到来，此时才进入合并窗口，避免高频 IPC 淹没前端。
//
// 判断标准：batch 为空 且 距上次 flush 超过 idleThreshold → 视为交互回显，立即发；
// 否则进入 coalesceWindow 合并，攒满 maxBatch 也立即发。
func pumpToEvent(ctx context.Context, r io.Reader, eventName, sessionID string, emit EmitFunc) {
	const (
		idleThreshold  = 8 * time.Millisecond
		coalesceWindow = 5 * time.Millisecond
		maxBatch       = 16 * 1024
	)

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
	var lastFlush time.Time // 零值：首笔数据必然视为「空闲后首包」立即发

	flush := func() {
		if len(batch) == 0 {
			return
		}
		if emit == nil {
			batch = batch[:0]
			lastFlush = time.Now()
			return
		}
		data := make([]byte, len(batch))
		copy(data, batch)
		emit(eventName, map[string]any{
			"data": string(data),
		})
		batch = batch[:0]
		lastFlush = time.Now()
	}

	flushTimer := time.NewTimer(coalesceWindow)
	if !flushTimer.Stop() {
		select {
		case <-flushTimer.C:
		default:
		}
	}
	stopTimer := func() {
		if !flushTimer.Stop() {
			select {
			case <-flushTimer.C:
			default:
			}
		}
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case res := <-readCh:
			if len(res.data) > 0 {
				// 空闲后的首包（典型：按键回显）→ 不等窗口，立即发
				firstAfterIdle := len(batch) == 0 && time.Since(lastFlush) >= idleThreshold
				batch = append(batch, res.data...)
				if firstAfterIdle || len(batch) >= maxBatch {
					stopTimer()
					flush()
				} else {
					// 连续流：进入短合并窗口
					stopTimer()
					flushTimer.Reset(coalesceWindow)
				}
			}
			if res.err != nil {
				flush()
				return
			}
		case <-flushTimer.C:
			flush()
		}
	}
}

// readResult 是 reader goroutine 的返回
type readResult struct {
	data []byte
	err  error
}
