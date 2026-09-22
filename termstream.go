package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"crypto/rand"
	"encoding/hex"

	"github.com/coder/websocket"
)

// termStreamServer 本地回环终端流服务。
//
// 一个终端会话对应一条独立的双向 WebSocket：连接 URL 中的 sid 决定它只收发
// 哪个 PTY 的数据。这样多个终端之间没有应用层复用队列、轮询器或共享写入锁。
// 每条连接拥有独立的输出队列；输入在该连接的读循环中直接顺序写入 PTY，
// 慢终端只会反压自己。
//
// 安全：只听 127.0.0.1 随机端口 + 随机 token（query 校验），本机其它进程拿不到
// token 无法连接。WebSocket 不可用时 manager 自动回退 Wails 事件，行为不变。
type termStreamServer struct {
	mu     sync.Mutex
	token  string
	subs   map[string]*termStreamSubscriber
	holds  map[string]*termStreamHandoff
	server *http.Server
	addr   string

	writeInput func(sid string, data []byte) error // 由 termMgr 注入；调用方拥有 data 的读取期
}

// termStreamHandoff 暂存一个正在跨 WebView 移动的 sid 的输出。
// hold 期间旧 WebView 不再收到输出，目标 WebView 建立订阅后 release 才按原顺序放行。
type termStreamHandoff struct {
	mu         sync.Mutex
	frames     [][]byte
	bytes      int
	outputWake chan struct{}
	released   bool
	closed     bool
}

func newTermStreamHandoff() *termStreamHandoff {
	return &termStreamHandoff{outputWake: make(chan struct{}, 1)}
}

func (h *termStreamHandoff) enqueue(frame []byte) bool {
	if len(frame) == 0 || len(frame) > termStreamMaxOutputBytes {
		return false
	}
	for {
		h.mu.Lock()
		if h.closed {
			h.mu.Unlock()
			return false
		}
		if len(h.frames) < termStreamMaxOutputFrame && h.bytes+len(frame) <= termStreamMaxOutputBytes {
			h.frames = append(h.frames, frame)
			h.bytes += len(frame)
			signalTermStream(h.outputWake)
			h.mu.Unlock()
			return true
		}
		wake := h.outputWake
		h.mu.Unlock()
		<-wake
	}
}

func (h *termStreamHandoff) drain() [][]byte {
	h.mu.Lock()
	frames := h.frames
	h.frames = nil
	h.bytes = 0
	signalTermStream(h.outputWake)
	h.mu.Unlock()
	return frames
}

// closeIfEmptyReleased 在同一把锁内完成最后一次空检查和关闭，
// 避免 flush 与 PTY 输出并发时，最后一个缓存帧落到关闭之后。
func (h *termStreamHandoff) closeIfEmptyReleased() (closed bool, released bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.released {
		return false, false
	}
	if len(h.frames) != 0 {
		return false, true
	}
	h.closed = true
	signalTermStream(h.outputWake)
	return true, true
}

func (h *termStreamHandoff) markReleased() {
	h.mu.Lock()
	h.released = true
	signalTermStream(h.outputWake)
	h.mu.Unlock()
}

func (h *termStreamHandoff) close() {
	h.mu.Lock()
	h.closed = true
	signalTermStream(h.outputWake)
	h.mu.Unlock()
}

const (
	termStreamMaxOutputBytes = 2 * 1024 * 1024
	termStreamMaxOutputFrame = 256

	// 二进制帧首字节。输入/输出都不再为每个按键创建 JSON 对象。
	termStreamFrameInput byte = 1
	termStreamFrameData  byte = 1
	termStreamFrameExit  byte = 2
)

type termStreamSubscriber struct {
	sid string
	mu  sync.Mutex

	outputFrames [][]byte
	outputBytes  int
	outputWake   chan struct{}

	done   chan struct{}
	closed bool
}

func newTermStreamSubscriber(sid string) *termStreamSubscriber {
	return &termStreamSubscriber{
		sid:        sid,
		outputWake: make(chan struct{}, 1),
		done:       make(chan struct{}),
	}
}

func signalTermStream(ch chan struct{}) {
	select {
	case ch <- struct{}{}:
	default:
	}
}

func (s *termStreamSubscriber) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	close(s.done)
	s.mu.Unlock()
}

func (s *termStreamSubscriber) enqueueOutput(frame []byte) bool {
	if len(frame) == 0 {
		return false
	}
	if len(frame) > termStreamMaxOutputBytes {
		return false
	}
	for {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return false
		}
		if len(s.outputFrames) < termStreamMaxOutputFrame &&
			s.outputBytes+len(frame) <= termStreamMaxOutputBytes {
			// frame 由 pushTerminalEvent 为本次事件新建，入队后不再复用；
			// 直接转移所有权，避免每个输出包再复制一次。
			s.outputFrames = append(s.outputFrames, frame)
			s.outputBytes += len(frame)
			signalTermStream(s.outputWake)
			s.mu.Unlock()
			return true
		}
		wake := s.outputWake
		done := s.done
		s.mu.Unlock()

		// 只阻塞产生这个 sid 输出的 SSH 会话；其它终端拥有自己的队列。
		select {
		case <-wake:
		case <-done:
			return false
		}
	}
}

func (s *termStreamSubscriber) nextOutput() ([]byte, bool) {
	for {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return nil, false
		}
		if len(s.outputFrames) > 0 {
			frame := s.outputFrames[0]
			s.outputFrames = s.outputFrames[1:]
			s.outputBytes -= len(frame)
			signalTermStream(s.outputWake)
			s.mu.Unlock()
			return frame, true
		}
		wake := s.outputWake
		done := s.done
		s.mu.Unlock()
		select {
		case <-wake:
		case <-done:
			return nil, false
		}
	}
}

func newTermStreamServer() *termStreamServer {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return &termStreamServer{
		token: hex.EncodeToString(b),
		subs:  make(map[string]*termStreamSubscriber),
		holds: make(map[string]*termStreamHandoff),
	}
}

func (t *termStreamServer) start() error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	t.addr = ln.Addr().String()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", t.handleWS)
	t.server = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = t.server.Serve(ln) }()
	return nil
}

// endpoint 返回给前端的连接信息（JSON 字符串：base 不带路径、token 走 query）。
// sid 不放进 endpoint，因为每个终端在打开自己的 PTY 后独立拼接连接地址。
func (t *termStreamServer) endpoint() string {
	return fmt.Sprintf(`{"base":"http://%s","token":"%s"}`, t.addr, t.token)
}

func (t *termStreamServer) shutdown() {
	t.mu.Lock()
	subs := make([]*termStreamSubscriber, 0, len(t.subs))
	for sid, sub := range t.subs {
		subs = append(subs, sub)
		delete(t.subs, sid)
	}
	holds := make([]*termStreamHandoff, 0, len(t.holds))
	for sid, hold := range t.holds {
		holds = append(holds, hold)
		delete(t.holds, sid)
	}
	t.mu.Unlock()
	for _, sub := range subs {
		sub.close()
	}
	for _, hold := range holds {
		hold.close()
	}
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

// handleWS 建立一个终端会话专属的 WebSocket。sid 是连接级身份，帧内不再重复携带。
// 输入二进制帧：0x01 + UTF-8；文本 "p" 只用于心跳；JSON 输入仍兼容旧客户端。
func (t *termStreamServer) handleWS(w http.ResponseWriter, r *http.Request) {
	if !t.checkToken(w, r) {
		return
	}
	sid := strings.TrimSpace(r.URL.Query().Get("sid"))
	if sid == "" {
		http.Error(w, "missing sid", http.StatusBadRequest)
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	c.SetReadLimit(4 << 20)
	sub := newTermStreamSubscriber(sid)
	t.mu.Lock()
	old := t.subs[sid]
	t.subs[sid] = sub
	t.mu.Unlock()
	if old != nil {
		old.close()
	}
	// release 可能先于 WebSocket 建立完成；建立订阅后再尝试冲刷交接缓冲。
	t.flushHandoff(sid)

	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			// WebSocket 自己会在连接关闭时结束 Read；不要为每个按键创建
			// 一个 10 秒 timer/context，这条循环就是输入热路径。
			typ, data, err := c.Read(r.Context())
			if err != nil {
				return
			}
			input, ok := decodeTermStreamInput(typ, data)
			if !ok {
				continue
			}
			if t.writeInput == nil || len(input) == 0 {
				return
			}
			// 一条连接只服务一个 sid，直接在该连接的读循环中顺序写入 PTY。
			// 不再经过共享/二次输入队列；其它终端由其它连接并行处理。
			if err := t.writeInput(sid, input); err != nil {
				return
			}
		}
	}()

	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		for {
			frame, ok := sub.nextOutput()
			if !ok {
				return
			}
			if err := c.Write(r.Context(), websocket.MessageBinary, frame); err != nil {
				return
			}
		}
	}()

	select {
	case <-readDone:
	case <-writeDone:
	}
	sub.close()
	_ = c.Close(websocket.StatusNormalClosure, "stream closed")
	<-readDone
	<-writeDone
	t.mu.Lock()
	if t.subs[sid] == sub {
		delete(t.subs, sid)
	}
	t.mu.Unlock()
}

func decodeTermStreamInput(typ websocket.MessageType, data []byte) ([]byte, bool) {
	if typ == websocket.MessageBinary {
		if len(data) < 2 || data[0] != termStreamFrameInput {
			return nil, false
		}
		// WebSocket Read 返回的 data 只在本次处理期间使用；保留二进制切片，
		// 避免每个按键先转成 string 再转回 []byte。
		return data[1:], true
	}
	if typ != websocket.MessageText || string(data) == "p" {
		return nil, false
	}
	var input struct {
		K string `json:"k"`
		D string `json:"d"`
	}
	if json.Unmarshal(data, &input) != nil || input.K != "input" || input.D == "" {
		return nil, false
	}
	return []byte(input.D), true
}

// pushTerminalEvent 实现 terminal.StreamPush：把一条终端事件写给它自己的连接。
// 没有该 sid 的订阅者时返回 false，manager 走 Wails 事件补发。
func (t *termStreamServer) pushTerminalEvent(kind, sid, _ string, data []byte) bool {
	if sid == "" {
		return false
	}
	t.mu.Lock()
	hold := t.holds[sid]
	sub := t.subs[sid]
	t.mu.Unlock()
	var frame []byte
	switch kind {
	case "data":
		frame = make([]byte, 1+len(data))
		frame[0] = termStreamFrameData
		copy(frame[1:], data)
	case "exit":
		frame = make([]byte, 1+len(data))
		frame[0] = termStreamFrameExit
		copy(frame[1:], data)
	default:
		return false
	}
	if hold != nil {
		if hold.enqueue(frame) {
			return true
		}
	}
	if sub == nil {
		// 没有订阅者时直接走 Wails 兜底，不要先分配一个永远丢弃的 frame。
		return false
	}

	if sub.enqueueOutput(frame) {
		return true
	}
	t.detach(sub)
	return false
}

func (t *termStreamServer) detach(sub *termStreamSubscriber) {
	if sub == nil {
		return
	}
	t.mu.Lock()
	if t.subs[sub.sid] == sub {
		delete(t.subs, sub.sid)
	}
	t.mu.Unlock()
	sub.close()
}

// hold 暂停一个 sid 的实时输出，供跨 WebView 移动时使用。
func (t *termStreamServer) hold(sid string) error {
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return fmt.Errorf("终端会话 ID 不能为空")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.holds[sid]; ok {
		return fmt.Errorf("终端会话正在移动")
	}
	t.holds[sid] = newTermStreamHandoff()
	return nil
}

// release 让目标订阅者接收交接期间缓存的输出；没有订阅者时等待其稍后建立。
func (t *termStreamServer) release(sid string) error {
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return nil
	}
	t.mu.Lock()
	hold := t.holds[sid]
	t.mu.Unlock()
	if hold == nil {
		return nil
	}
	hold.markReleased()
	t.mu.Lock()
	sub := t.subs[sid]
	if sub == nil && t.holds[sid] == hold {
		delete(t.holds, sid)
	}
	t.mu.Unlock()
	if sub == nil {
		// 目标浏览器没有建立专属 WS 时，放弃交接缓存并恢复 Wails 兜底；
		// 否则 hold 会永远占住该 sid 的输出。
		hold.close()
		return nil
	}
	t.flushHandoff(sid)
	return nil
}

func (t *termStreamServer) flushHandoff(sid string) {
	for {
		t.mu.Lock()
		hold := t.holds[sid]
		sub := t.subs[sid]
		t.mu.Unlock()
		if hold == nil || sub == nil {
			return
		}
		closed, released := hold.closeIfEmptyReleased()
		if !released {
			// 目标 WebSocket 可以先于 CompleteTerminalTransfer 建立，
			// 但在交接完成前不能把缓存输出放到快照之前。
			return
		}
		if closed {
			t.mu.Lock()
			if t.holds[sid] == hold {
				delete(t.holds, sid)
			}
			t.mu.Unlock()
			return
		}
		frames := hold.drain()
		for _, frame := range frames {
			if !sub.enqueueOutput(frame) {
				return
			}
		}
		closed, released = hold.closeIfEmptyReleased()
		if !released {
			return
		}
		if !closed {
			// PTY 输出可能正好在 drain 与最后一次空检查之间到达。
			// 继续下一轮，把这批并发到达的帧也交给目标订阅者，直到
			// 在同一把锁下确认 released 且缓冲为空。
			continue
		}
		t.mu.Lock()
		if t.holds[sid] == hold {
			delete(t.holds, sid)
		}
		t.mu.Unlock()
		return
	}
}
