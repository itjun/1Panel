package terminal

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

	"diteng-pannel/internal/sshd"
)

// WS 数据通道：终端的高频小数据（按键、回显）走 localhost WebSocket 二进制帧，
// 绕开 Wails Events 的「JSON 序列化 + WebView 主线程 JS 注入」开销，达到接近原生的延迟。
// 输入输出都走 WS；Resize / Close 频率低，仍走 Wails 绑定方法。
//
// 安全边界：
//   - 服务只监听 127.0.0.1，随机端口
//   - 每个会话一次性随机 token，attach 成功即失效（attached 置位后拒绝再次 attach）
//   - 前端超时未 attach 的会话自动回收

const wsAttachTimeout = 15 * time.Second

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  32 * 1024,
	WriteBufferSize: 32 * 1024,
	// 仅监听回环地址且有会话 token 鉴权；WebView 的 Origin（wails://）无需校验
	CheckOrigin: func(*http.Request) bool { return true },
}

// OpenWS 启动一个 WS 模式终端会话，返回 (sessionID, wsURL)
// SSH 会话立即建立；输出等前端 attach 后才开始泵送，
// attach 前的少量输出（登录 banner 等）滞留在 SSH channel 缓冲区，不会丢失。
func (m *Manager) OpenWS(host string, opt sshd.ConnectOption, cols, rows int) (string, string, error) {
	addr, err := m.ensureWSServer()
	if err != nil {
		return "", "", fmt.Errorf("启动终端数据通道失败: %w", err)
	}

	session, stdin, stdout, err := m.openShell(host, opt, cols, rows)
	if err != nil {
		return "", "", err
	}

	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		_ = session.Close()
		return "", "", fmt.Errorf("生成会话 token 失败: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)

	id := uuid.NewString()
	parentCtx := m.ctx
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	_, cancel := context.WithCancel(parentCtx)
	s := &Session{
		ID:       id,
		Host:     host,
		session:  session,
		stdin:    stdin,
		cancel:   cancel,
		wsToken:  token,
		wsStdout: stdout,
	}

	// shell 退出（exit 命令 / 网络断开 / 主动 Close）→ 用 WS 关闭帧告知前端原因
	go func() {
		werr := session.Wait()
		s.mu.Lock()
		userClosed := s.closed
		s.closed = true
		s.mu.Unlock()

		reason := "exit"
		if !userClosed && werr != nil {
			if _, ok := werr.(*ssh.ExitError); !ok {
				reason = "error"
			}
		}
		s.closeWS(reason)
		m.mu.Lock()
		delete(m.sessions, id)
		m.mu.Unlock()
	}()

	// 前端超时未 attach（异常崩溃等）→ 回收会话，避免远程 shell 悬挂
	go func() {
		time.Sleep(wsAttachTimeout)
		s.mu.Lock()
		orphan := !s.attached && !s.closed
		s.mu.Unlock()
		if orphan {
			_ = m.Close(id)
		}
	}()

	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()

	url := fmt.Sprintf("ws://%s/term?id=%s&token=%s", addr, id, token)
	return id, url, nil
}

// ensureWSServer 懒启动 WS 服务（仅监听 127.0.0.1 随机端口，整个应用共用一个）
func (m *Manager) ensureWSServer() (string, error) {
	m.wsMu.Lock()
	defer m.wsMu.Unlock()
	if m.wsAddr != "" {
		return m.wsAddr, nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/term", m.handleTermWS)
	srv := &http.Server{Handler: mux}
	go func() {
		_ = srv.Serve(ln)
	}()
	m.wsAddr = ln.Addr().String()
	return m.wsAddr, nil
}

// handleTermWS 前端 attach：校验会话 token 后升级为 WebSocket，
// 启动输出泵（SSH stdout → WS）与输入泵（WS → SSH stdin）
func (m *Manager) handleTermWS(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	token := r.URL.Query().Get("token")

	m.mu.Lock()
	s, ok := m.sessions[id]
	m.mu.Unlock()
	if !ok || s.wsToken == "" ||
		subtle.ConstantTimeCompare([]byte(token), []byte(s.wsToken)) != 1 {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	s.mu.Lock()
	if s.closed || s.attached {
		s.mu.Unlock()
		_ = conn.Close()
		return
	}
	s.attached = true
	s.wsConn = conn
	stdout := s.wsStdout
	s.mu.Unlock()

	// 输出泵：SSH stdout → WS 二进制帧。
	// 不做任何人工合并/延迟：WS 本地回环开销极低，xterm.js 内部自带写入队列。
	// conn 的数据帧只有这一个 writer；退出关闭帧走 WriteControl（gorilla 允许并发）。
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, rerr := stdout.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					return
				}
			}
			if rerr != nil {
				return
			}
		}
	}()

	// 输入泵：WS → SSH stdin。WS 断开（前端关标签/刷新/崩溃）→ 关闭会话，避免孤儿 shell
	go func() {
		for {
			_, data, rerr := conn.ReadMessage()
			if rerr != nil {
				_ = m.Close(s.ID)
				return
			}
			if len(data) == 0 {
				continue
			}
			s.mu.Lock()
			closed := s.closed
			s.mu.Unlock()
			if closed {
				return
			}
			if _, werr := s.stdin.Write(data); werr != nil {
				return
			}
		}
	}()
}

// closeWS 向前端发送带原因的关闭帧并断开 WS
// reason: "exit"（正常退出/主动关闭，前端不重连）| "error"（异常断开，前端自动重连）
func (s *Session) closeWS(reason string) {
	s.mu.Lock()
	conn := s.wsConn
	s.wsConn = nil
	s.mu.Unlock()
	if conn == nil {
		return
	}
	msg := websocket.FormatCloseMessage(websocket.CloseNormalClosure, reason)
	_ = conn.WriteControl(websocket.CloseMessage, msg, time.Now().Add(time.Second))
	_ = conn.Close()
}
