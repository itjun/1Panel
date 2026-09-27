package boardhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/groupid"
)

// Server 同进程只读看板 HTTP 网关。
type Server struct {
	mu     sync.Mutex
	cfg    Config
	srv    *http.Server
	assets fs.FS
	data   DataSource
	logger *log.Logger
}

// New 创建未启动的服务。assets 应为 frontend/dist 根。
func New(assets fs.FS, data DataSource, logger *log.Logger) *Server {
	if logger == nil {
		logger = log.Default()
	}
	return &Server{
		cfg:    DefaultConfig(),
		assets: assets,
		data:   data,
		logger: logger,
	}
}

// Config 返回当前配置副本。
func (s *Server) Config() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

// Apply 更新配置并热重载监听（Enabled=false 则停止）。
func (s *Server) Apply(cfg Config) error {
	if cfg.Port <= 0 || cfg.Port > 65535 {
		return fmt.Errorf("端口无效: %d", cfg.Port)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	return s.restartLocked()
}

// Start 按 cfg 启动（或保持停用）。
func (s *Server) Start(cfg Config) error {
	return s.Apply(cfg)
}

// Stop 关闭监听。
func (s *Server) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

func (s *Server) restartLocked() error {
	s.stopLocked()
	if !s.cfg.Enabled {
		return nil
	}
	addr := ":" + strconv.Itoa(s.cfg.Port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("看板 HTTP 监听 %s 失败: %w", addr, err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.serveRoot)
	handler := s.gate(methodGuard(mux))
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	s.srv = srv
	go func() {
		err := srv.Serve(ln)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Printf("看板 HTTP 服务异常: %v", err)
		}
	}()
	s.logger.Printf("看板 HTTP 已监听 %s（仅私网 IPv4）", addr)
	return nil
}

func (s *Server) stopLocked() {
	if s.srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
	s.srv = nil
}

func (s *Server) gate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !AllowClient(r) {
			http.Error(w, "仅允许内网访问", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func methodGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "只读", http.StatusMethodNotAllowed)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) serveRoot(w http.ResponseWriter, r *http.Request) {
	p := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))

	if strings.HasPrefix(p, "/api/board") {
		s.serveAPI(w, r, p)
		return
	}

	rel := strings.TrimPrefix(p, "/")
	if rel == "" {
		http.NotFound(w, r)
		return
	}
	if s.tryStatic(w, r, rel) {
		return
	}

	group := rel
	if strings.Contains(group, "/") {
		http.NotFound(w, r)
		return
	}
	if err := groupid.Validate(group); err != nil {
		http.NotFound(w, r)
		return
	}
	if _, ok := s.data.FindGroup(group); !ok {
		http.Error(w, "分组不存在", http.StatusNotFound)
		return
	}
	s.serveIndex(w, r)
}

func (s *Server) tryStatic(w http.ResponseWriter, r *http.Request, rel string) bool {
	if s.assets == nil || strings.Contains(rel, "..") {
		return false
	}
	st, err := fs.Stat(s.assets, rel)
	if err != nil || st.IsDir() {
		return false
	}
	data, err := fs.ReadFile(s.assets, rel)
	if err != nil {
		return false
	}
	http.ServeContent(w, r, path.Base(rel), st.ModTime(), bytes.NewReader(data))
	return true
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	if s.assets == nil {
		http.Error(w, "前端资源未就绪", http.StatusServiceUnavailable)
		return
	}
	data, err := fs.ReadFile(s.assets, "index.html")
	if err != nil {
		http.Error(w, "前端资源未就绪", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(data))
}

func (s *Server) serveAPI(w http.ResponseWriter, r *http.Request, p string) {
	if p == "/api/board/settings" {
		writeJSON(w, s.data.BoardSettings())
		return
	}

	rest := strings.TrimPrefix(p, "/api/board/")
	if rest == "" || rest == p {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(rest, "/")
	group := parts[0]
	if err := groupid.Validate(group); err != nil {
		http.NotFound(w, r)
		return
	}
	info, ok := s.data.FindGroup(group)
	if !ok {
		http.Error(w, "分组不存在", http.StatusNotFound)
		return
	}

	if len(parts) == 1 {
		writeJSON(w, info)
		return
	}

	if len(parts) < 4 || parts[1] != "hosts" {
		http.NotFound(w, r)
		return
	}
	host := parts[2]
	if !s.data.HostInGroup(group, host) {
		http.Error(w, "主机不属于该分组", http.StatusNotFound)
		return
	}
	action := parts[3]
	switch action {
	case "overview":
		ov, err := s.data.CollectOverview(host)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, ov)
	case "disks":
		disks, err := s.data.CollectDisks(host)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, disks)
	case "range":
		q := r.URL.Query()
		from, _ := strconv.ParseInt(q.Get("from"), 10, 64)
		to, _ := strconv.ParseInt(q.Get("to"), 10, 64)
		src := q.Get("src")
		if src == "" {
			src = "auto"
		}
		rr, err := s.data.AgentRange(host, from, to, src)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, rr)
	case "watch-instances":
		rows, err := s.data.AgentWatchInstances(host)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, rows)
	default:
		http.NotFound(w, r)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	msg := err.Error()
	code := http.StatusBadGateway
	if strings.Contains(msg, "未安装") || strings.Contains(msg, "not installed") {
		code = http.StatusServiceUnavailable
	}
	http.Error(w, msg, code)
}
