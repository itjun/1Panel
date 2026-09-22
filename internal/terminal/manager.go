package terminal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty/v2"
	"github.com/google/uuid"

	"diteng-pannel/internal/sshd"
)

// EmitFunc 把事件推送给前端（由上层注入，Events 模式下使用）
// 返回是否被取消（语义与 wails v3 application.Event.Emit 对齐）
type EmitFunc func(eventName string, data ...any) bool

// StreamPush 终端数据的流式出口（本地 WebSocket）：kind 为 "data" 或 "exit"，
// 其余参数为 sid、pane 和原始字节。返回 false 表示当前无订阅者，调用方应回退
// EmitFunc 通道。data 只在调用期间有效，出口不得持有该切片；两条通道同一时刻
// 只有一条在用。
type StreamPush func(kind, sid, pane string, data []byte) bool

// Manager 管理终端会话
// 设计：
//   - 每个 Tab 创建一个独立的系统 ssh 进程，完全读取 Panel 生成的 OpenSSH config
//   - 用本地 PTY 连接进程，保留 OpenSSH 的 ProxyJump、Agent、HostKey 等行为
//   - 数据通道：优先本地 WebSocket 流（绕开 wails 主线程事件派发），无订阅者时
//     回退 Wails 事件推送（异步非阻塞，见 pumpToEvent）
//   - 关闭 Tab → 关 session + 关独立连接 → 远程 shell 收到 EOF 退出
type Manager struct {
	ctx      context.Context
	sshMgr   *sshd.Manager
	mu       sync.RWMutex
	sessions map[string]*Session

	emit EmitFunc // 事件推送（注入，可空则跳过）

	streamMu   sync.RWMutex
	streamPush StreamPush // WebSocket 出口（注入，可空）
}

// Session 一个终端会话，对应一条独立 SSH 连接上的 channel + PTY
type Session struct {
	ID          string
	Host        string
	cmd         *exec.Cmd
	terminal    *os.File
	stdin       io.WriteCloser
	cancel      context.CancelFunc // 用于停止输出 goroutine
	outputClose io.Closer
	mu          sync.Mutex
	closed      bool
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

// SetStreamPush 注入 WebSocket 流出口。两条数据通道同一时刻只有一条在用：
// push 返回 false（无订阅者）时回退 emit。
func (m *Manager) SetStreamPush(push StreamPush) {
	m.streamMu.Lock()
	m.streamPush = push
	m.streamMu.Unlock()
}

// sendData 输出数据双出口：WebSocket 优先，无订阅者回退 Wails 事件
func (m *Manager) sendData(eventName, sid string, data []byte) {
	m.streamMu.RLock()
	push := m.streamPush
	m.streamMu.RUnlock()
	if push != nil {
		if push("data", sid, strings.TrimPrefix(eventName, "term:"), data) {
			return
		}
	}
	if m.emit != nil {
		m.emit(eventName, map[string]any{"data": string(data)})
	}
}

// sendExit 会话结束双出口：WebSocket 优先，无订阅者回退 Wails 事件
func (m *Manager) sendExit(eventName, sid, reason string) {
	m.streamMu.RLock()
	push := m.streamPush
	m.streamMu.RUnlock()
	if push != nil {
		if push("exit", sid, strings.TrimPrefix(eventName, "term:"), []byte(reason)) {
			return
		}
	}
	if m.emit != nil {
		m.emit(eventName+":exit", map[string]any{
			"sessionId": sid,
			"reason":    reason,
		})
	}
}

type nativeShell struct {
	cmd         *exec.Cmd
	terminal    *os.File
	stdin       io.WriteCloser
	output      io.Reader
	outputClose io.Closer
}

// openShell starts the system OpenSSH client. The Go ConnectOption is not
// consulted here by design: the terminal must exercise exactly the same
// ~/.ssh/config that an external terminal would use.
func (m *Manager) openShell(host string, cols, rows int) (*nativeShell, context.CancelFunc, error) {
	if m.ctx == nil {
		return nil, nil, fmt.Errorf("终端管理器未初始化")
	}
	if cols < 20 {
		cols = 80
	}
	if rows < 5 {
		rows = 24
	}

	parentCtx := m.ctx
	ctx, cancel := context.WithCancel(parentCtx)
	cmd := exec.CommandContext(ctx, "ssh", "-tt", "--", host)
	terminal, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
	if err != nil {
		if !errors.Is(err, pty.ErrUnsupported) {
			cancel()
			return nil, nil, fmt.Errorf("启动系统 ssh 失败: %w", err)
		}
		// pty 在 Windows 等平台不可用时仍然保留系统 ssh 接入能力。
		// 这些平台没有可调整的本地 PTY，因此用 stdin/stdout/stderr 管道
		// 作为明确的降级路径；Unix/macOS 仍优先走上面的真实 PTY。
		shell, pipeErr := startPipeShell(cmd)
		if pipeErr != nil {
			cancel()
			return nil, nil, fmt.Errorf("启动系统 ssh 失败: %w", pipeErr)
		}
		return shell, cancel, nil
	}
	return &nativeShell{cmd: cmd, terminal: terminal, stdin: terminal, output: terminal}, cancel, nil
}

// startPipeShell starts an already-created command without a local PTY. It is
// intentionally small and only used when the current platform reports that
// PTY allocation is unsupported. stdout and stderr are merged in arrival
// order into one reader so the rest of the terminal pipeline remains the same.
func startPipeShell(cmd *exec.Cmd) (*nativeShell, error) {
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stderr.Close()
		return nil, err
	}

	output, outputWriter := io.Pipe()
	var wg sync.WaitGroup
	var writeMu sync.Mutex
	copyOutput := func(reader io.ReadCloser) {
		defer wg.Done()
		defer reader.Close()
		buf := make([]byte, 4096)
		for {
			n, readErr := reader.Read(buf)
			if n > 0 {
				writeMu.Lock()
				_, writeErr := outputWriter.Write(buf[:n])
				writeMu.Unlock()
				if writeErr != nil {
					return
				}
			}
			if readErr != nil {
				return
			}
		}
	}
	wg.Add(2)
	go copyOutput(stdout)
	go copyOutput(stderr)
	go func() {
		wg.Wait()
		_ = outputWriter.Close()
	}()

	return &nativeShell{cmd: cmd, stdin: stdin, output: output, outputClose: output}, nil
}

// Open 启动一个终端会话（独立 SSH 连接 + Wails 事件推送）
// host 是目标主机别名，eventName 是前端用来接收输出的 Wails 事件名
func (m *Manager) Open(host string, opt sshd.ConnectOption, eventName string, cols, rows int) (string, error) {
	_ = opt
	shell, shellCancel, err := m.openShell(host, cols, rows)
	if err != nil {
		return "", err
	}

	id := uuid.NewString()
	parentCtx := m.ctx
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	ctx, pumpCancel := context.WithCancel(parentCtx)
	cancel := func() {
		pumpCancel()
		shellCancel()
	}
	s := &Session{
		ID:          id,
		Host:        host,
		cmd:         shell.cmd,
		terminal:    shell.terminal,
		stdin:       shell.stdin,
		cancel:      cancel,
		outputClose: shell.outputClose,
	}

	// 把远程 shell 的输出流推送给前端（WebSocket 优先，回退 Wails 事件）
	go pumpToEvent(ctx, shell.output, func(data []byte) { m.sendData(eventName, id, data) })

	// 进程结束时通知前端 + 清理。
	// 区分断开原因：正常退出（exit 命令）reason=exit，异常断开（网络等）reason=error，
	// 前端据此决定是否自动重连。
	go func() {
		err := shell.cmd.Wait()
		reason := "exit"
		if err != nil {
			reason = "error"
		}
		// Wait 返回后必须释放独立连接与心跳，避免泄漏；与手动 Close 共用 release
		s.release()
		m.sendExit(eventName, id, reason)
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
	m.mu.RLock()
	s, ok := m.sessions[sessionID]
	m.mu.RUnlock()
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
	m.mu.RLock()
	s, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return nil
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	if s.terminal == nil {
		return nil
	}
	return pty.Setsize(s.terminal, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
}

// release 幂等释放：停止输出泵、关闭本地 PTY 并终止对应的系统 ssh 进程。
func (s *Session) release() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.mu.Unlock()

	if s.cancel != nil {
		s.cancel()
	}
	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if s.outputClose != nil {
		_ = s.outputClose.Close()
	}
	if s.terminal != nil {
		_ = s.terminal.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
}

// Close 关闭一个终端会话（关 stdin + 关 session + 关独立连接，远程 shell 收到 EOF 退出）
func (m *Manager) Close(sessionID string) error {
	m.mu.RLock()
	s, ok := m.sessions[sessionID]
	m.mu.RUnlock()
	if !ok {
		return nil
	}
	s.release()
	return nil
}

// CloseByHost 关闭指定主机的全部终端会话（每会话独占连接，一并释放）
func (m *Manager) CloseByHost(host string) {
	host = strings.TrimSpace(host)
	if host == "" {
		return
	}
	m.mu.RLock()
	ids := make([]string, 0, 2)
	for id, s := range m.sessions {
		if s != nil && s.Host == host {
			ids = append(ids, id)
		}
	}
	m.mu.RUnlock()
	for _, id := range ids {
		_ = m.Close(id)
	}
}

// CloseAll 应用退出时调用
func (m *Manager) CloseAll() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		_ = m.Close(id)
	}
}

// pumpToEvent 把远程 shell 的 stdout 读取并推送给前端（send 为当前生效的数据出口）
//
// 延迟与吞吐的平衡（leading-edge 合并）：
//   - 交互打字：回显是「空闲后到来的一小段数据」，必须立即发，任何合并窗口都是纯延迟；
//   - 流式输出（cat 大文件）：读取会连续到来，此时才进入合并窗口，避免高频 IPC 淹没前端。
//
// 判断标准：batch 为空 且 距上次 flush 超过 idleThreshold → 视为交互回显，立即发；
// 否则进入 coalesceWindow 合并，攒满 maxBatch 也立即发。
func pumpToEvent(ctx context.Context, r io.Reader, send func(data []byte)) {
	const (
		// 交互回显优先：连续快速输入时也不要把第二个字符额外压满 5ms。
		// 1ms 仍能合并高吞吐输出，但不会形成可感知的按键尾延迟。
		idleThreshold  = 4 * time.Millisecond
		coalesceWindow = 1 * time.Millisecond
		maxBatch       = 16 * 1024
	)

	readCh := make(chan readResult, 4)
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
		// send 在当前 goroutine 中同步完成：WebSocket 出口会复制到带类型字节帧，
		// Wails 兜底会同步转换成 string。因此这里可以直接转移 batch 的读取期，
		// 避免连续输出再做一次 copy + []byte→string。
		data := batch
		batch = nil
		send(data)
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
				// 空闲后的首包（典型：按键回显）→ 直接发送。
				// 以前会先 append、再复制 batch、再转 string；交互输入每个
				// 字符都走这里，直接路径少两次内存操作。
				firstAfterIdle := len(batch) == 0 && time.Since(lastFlush) >= idleThreshold
				if firstAfterIdle {
					// 首包直接转移 reader 为本次结果分配的切片，避免交互回显
					// 经过 batch append、复制和 string 转换。
					send(res.data)
					lastFlush = time.Now()
				} else {
					batch = append(batch, res.data...)
				}
				if !firstAfterIdle && len(batch) >= maxBatch {
					stopTimer()
					flush()
				} else if !firstAfterIdle {
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
