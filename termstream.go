package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

// termStreamServer 本地回环终端流服务：终端输出走 SSE、输入走 fetch，
// 绕开 wails v3 在 darwin 上的两条主线程通道（Events.Emit 逐条 evaluateJS、
// binding 的 WKScriptMessage 回调）。机器渲染繁忙时这两条通道会把按键回显
// 排在长队列后面——实测网络 RTT 0.66ms、SSH 层回显 1.8ms，延迟主要产生于此。
//
// 安全：只听 127.0.0.1 随机端口 + 随机 token（query 校验），本机其它进程拿不到
// token 无法连接。无 SSE 订阅者时 manager 自动回退 wails 事件通道，行为不变。
type termStreamServer struct {
	mu     sync.Mutex
	token  string
	subs   map[chan string]struct{}
	server *http.Server
	addr   string

	writeInput func(sid string, data string) error // 由 termMgr 注入
}

func newTermStreamServer() *termStreamServer {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return &termStreamServer{token: hex.EncodeToString(b), subs: map[chan string]struct{}{}}
}

func (t *termStreamServer) start() error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	t.addr = ln.Addr().String()
	mux := http.NewServeMux()
	mux.HandleFunc("/stream", t.handleStream)
	mux.HandleFunc("/input", t.handleInput)
	mux.HandleFunc("/drop", t.handleDrop)
	t.server = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = t.server.Serve(ln) }()
	return nil
}

// endpoint 返回给前端的连接信息（JSON 字符串：base 不带路径、token 走 query）
func (t *termStreamServer) endpoint() string {
	return fmt.Sprintf(`{"base":"http://%s","token":"%s"}`, t.addr, t.token)
}

func (t *termStreamServer) shutdown() {
	if t.server != nil {
		_ = t.server.Close()
	}
}

func (t *termStreamServer) checkToken(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Query().Get("t") == t.token {
		return true
	}
	http.Error(w, "forbidden", http.StatusForbidden)
	return false
}

// handleStream SSE 长连接：一条连接复用所有终端会话（事件 payload 带 pane 标识），
// 避免 WKWebView 对同源 6 连接的限制。
func (t *termStreamServer) handleStream(w http.ResponseWriter, r *http.Request) {
	if !t.checkToken(w, r) {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, "retry: 1000\n\n") // 断开后前端 1s 自动重连
	flusher.Flush()

	ch := make(chan string, 64)
	t.mu.Lock()
	// 单订阅者：终端前端全局只有一条 EventSource，新连接进来说明旧连接已断
	// （半开 TCP 检测很慢，旧 handler 可能还挂着）。立刻踢掉旧订阅，
	// 否则数据被推进无人消费的旧 channel——Go 以为推送成功不再走 Events，
	// 前端两条通道都收不到，表现为回显整段丢失。
	for old := range t.subs {
		close(old)
		delete(t.subs, old)
	}
	t.subs[ch] = struct{}{}
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.subs, ch)
		t.mu.Unlock()
	}()

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case msg := <-ch:
			if msg == "" { // 被推送方关闭（消费太慢）
				return
			}
			if _, err := fmt.Fprint(w, msg); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// handleInput 终端输入：前端 fetch POST JSON 字符串（默认 text/plain，无预检）。
func (t *termStreamServer) handleInput(w http.ResponseWriter, r *http.Request) {
	if !t.checkToken(w, r) {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Sid string `json:"sid"`
		D   string `json:"d"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil ||
		body.Sid == "" || t.writeInput == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := t.writeInput(body.Sid, body.D); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDrop 前端 EventSource 断连时主动调用：立刻清空全部订阅，
// 让数据马上回退 wails Events 通道。半开 TCP 上 handler 的写会"成功"进内核
// 缓冲，不主动清的话断连到重连之间的回显会被推进死连接——表现为丢字。
func (t *termStreamServer) handleDrop(w http.ResponseWriter, r *http.Request) {
	if !t.checkToken(w, r) {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusNoContent)
	t.mu.Lock()
	for ch := range t.subs {
		close(ch)
		delete(t.subs, ch)
	}
	t.mu.Unlock()
}

// pushTerminalEvent 实现 terminal.StreamPush：把一条终端事件写给当前订阅者。
// 返回 false（无订阅者 / 消费者卡死被踢）时调用方走 wails 事件通道补发，
// 保证任何情况下数据都有出口、不丢帧。
func (t *termStreamServer) pushTerminalEvent(kind string, payload string) bool {
	frame := "event: " + kind + "\ndata: " + payload + "\n\n"
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.subs) == 0 {
		return false
	}
	sent := true
	for ch := range t.subs {
		select {
		case ch <- frame:
		default:
			// 消费方卡死（webview 不再读）：关闭该订阅并降级，
			// 本帧改走 Events 通道补发，前端 EventSource 会自动重连
			close(ch)
			delete(t.subs, ch)
			sent = false
		}
	}
	return sent
}
