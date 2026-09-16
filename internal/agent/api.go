package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshd"
)

// localRunner 在本机执行命令（monitor.Runner 的 agent 实现）。
// 面板时期的采集脚本原样在 agent 本地跑，解析器两边共用。
type localRunner struct{}

func (localRunner) Run(_ string, _ sshd.ConnectOption, cmd string, runOpts ...sshd.RunOptions) ([]byte, error) {
	timeout := 30 * time.Second
	if len(runOpts) > 0 && runOpts[0].Timeout > 0 {
		timeout = runOpts[0].Timeout
	}
	return runShellCombined(cmd, timeout)
}

// runShellCombined 用 sh 执行脚本并返回 stdout+stderr 合并输出，
// 语义等价 exec.Command(sh, -c, script).CombinedOutput()：
// 脚本经 stdin 管道传入（不进 argv）；独立进程组，超时杀整组，
// 避免 sh 的子进程残留；读取与写入并发进行，防管道缓冲死锁。
func runShellCombined(script string, timeout time.Duration) ([]byte, error) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		return nil, err
	}
	stdinR, stdinW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	outR, outW, err := os.Pipe()
	if err != nil {
		stdinR.Close()
		stdinW.Close()
		return nil, err
	}
	proc, err := os.StartProcess(sh, []string{"sh"}, &os.ProcAttr{
		Files: []*os.File{stdinR, outW, outW},
		Sys:   &syscall.SysProcAttr{Setpgid: true},
	})
	// 子进程已继承句柄副本，父进程侧立即关闭，否则管道永不见 EOF
	stdinR.Close()
	outW.Close()
	if err != nil {
		stdinW.Close()
		outR.Close()
		return nil, err
	}

	// 先起读取协程再写脚本：输出超过管道缓冲时 sh 会阻塞在写侧
	outCh := make(chan struct{})
	out := []byte(nil)
	readErr := error(nil)
	go func() {
		out, readErr = io.ReadAll(outR)
		close(outCh)
	}()
	go func() {
		_, _ = stdinW.WriteString(script)
		stdinW.Close()
	}()

	var timedOut atomic.Bool
	timer := time.AfterFunc(timeout, func() {
		timedOut.Store(true)
		_ = syscall.Kill(-proc.Pid, syscall.SIGKILL)
	})
	state, waitErr := proc.Wait()
	timer.Stop()
	<-outCh
	outR.Close()

	if waitErr == nil && timedOut.Load() {
		waitErr = context.DeadlineExceeded
	}
	if waitErr == nil && state != nil && !state.Success() {
		waitErr = fmt.Errorf("exit status %d", state.ExitCode())
	}
	if waitErr != nil {
		return out, waitErr
	}
	return out, readErr
}

// Server agent 本地 HTTP 服务（只绑 127.0.0.1）
type Server struct {
	store     *Store
	mc        *MetricCollector
	retention Retention
	version   string
	startTime time.Time
	token     string // 空 = 鉴权关闭

	// 静态信息缓存（5 分钟刷新）
	infoMu    sync.Mutex
	info      HostInfo
	collector *monitor.Collector
	watcher   *Watcher
}

// NewServer token 为空串表示关闭 Bearer 鉴权
func NewServer(store *Store, mc *MetricCollector, retention Retention, version, token string) *Server {
	return &Server{
		store:     store,
		mc:        mc,
		retention: retention,
		version:   version,
		startTime: time.Now(),
		token:     token,
		collector: monitor.NewCollector(localRunner{}),
		info:      CollectHostInfo(mc.procRoot),
	}
}

func (s *Server) SetWatcher(w *Watcher) {
	s.watcher = w
}

// collectFunc 按需采集处理函数：拿到共享的 Collector 和本次请求的 query
type collectFunc func(c *monitor.Collector, q url.Values) (any, error)

func (s *Server) collect(fn collectFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, err := fn(s.collector, r.URL.Query())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, v)
	}
}

// collectNoQuery 无参数采集端点的快捷封装
func (s *Server) collectNoQuery(fn func(c *monitor.Collector) (any, error)) http.HandlerFunc {
	return s.collect(func(c *monitor.Collector, _ url.Values) (any, error) { return fn(c) })
}

// Handler 构造路由；鉴权中间件包裹全部端点
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /info", s.handleInfo)
	mux.HandleFunc("GET /metrics/current", s.handleCurrent)
	mux.HandleFunc("GET /metrics/range", s.handleRange)
	mux.HandleFunc("GET /metrics/summary", s.handleSummary)
	mux.HandleFunc("GET /events", s.handleEvents)
	mux.HandleFunc("GET /watch/status", s.handleWatchStatus)
	mux.HandleFunc("GET /watch/instances", s.handleWatchInstances)
	mux.HandleFunc("GET /watch/range", s.handleWatchRange)
	mux.HandleFunc("GET /watch/events", s.handleWatchEvents)
	mux.HandleFunc("GET /admin/watch", s.handleAdminWatchGet)
	mux.HandleFunc("POST /admin/watch", s.handleAdminWatchPost)

	// 按需采集：与面板 monitor.Collector 方法 1:1，本地执行
	var local = sshd.ConnectOption{}
	mux.HandleFunc("GET /collect/disks", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectDisks("local", local)
	}))
	mux.HandleFunc("GET /collect/processes", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		return c.CollectProcesses("local", local, queryInt(q, "limit", 30))
	}))
	mux.HandleFunc("GET /collect/network", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectNetwork("local", local)
	}))
	mux.HandleFunc("GET /collect/docker", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectDocker("local", local)
	}))
	mux.HandleFunc("GET /collect/docker-inspect", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		return c.CollectDockerInspect("local", q.Get("container"), local)
	}))
	mux.HandleFunc("GET /collect/services", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectServices("local", local)
	}))
	mux.HandleFunc("GET /collect/service-detail", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		return c.CollectServiceDetail("local", q.Get("name"), local)
	}))
	mux.HandleFunc("GET /collect/crons", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectCrons("local", local)
	}))
	mux.HandleFunc("GET /collect/packages", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectPackages("local", local)
	}))
	mux.HandleFunc("GET /collect/package-depends", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		return c.CollectPackageDepends("local", local, q.Get("name"))
	}))
	mux.HandleFunc("GET /collect/runtimes", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectRuntimes("local", local)
	}))
	mux.HandleFunc("GET /collect/runtime-procs", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		return c.CollectRuntimeProcs("local", q.Get("runtime"), local)
	}))
	mux.HandleFunc("GET /collect/runtime-counts", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectRuntimeCounts("local", local)
	}))
	mux.HandleFunc("GET /collect/java", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectJava("local", local)
	}))
	mux.HandleFunc("GET /collect/java-proc-detail", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		pid := uint32(queryInt(q, "pid", 0))
		return c.CollectJavaProcDetail("local", pid, local)
	}))
	mux.HandleFunc("GET /collect/logs", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		return c.CollectLog("local", q.Get("type"), local, queryInt(q, "lines", 100))
	}))
	mux.HandleFunc("GET /collect/certs", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectCerts("local", local)
	}))
	mux.HandleFunc("GET /collect/hosts", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.CollectHosts("local", local)
	}))
	mux.HandleFunc("GET /collect/largest-files", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		root := q.Get("root")
		if root == "" {
			root = "/"
		}
		return c.CollectLargestFiles("local", local, root, queryInt(q, "limit", 20))
	}))
	mux.HandleFunc("GET /collect/os-release", s.collectNoQuery(func(c *monitor.Collector) (any, error) {
		return c.DetectOSRelease("local", local)
	}))
	mux.HandleFunc("GET /collect/home-dir", s.handleHomeDir)
	mux.HandleFunc("GET /collect/dir", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		return c.ListDir("local", local, q.Get("path"))
	}))
	mux.HandleFunc("GET /collect/file-text", s.collect(func(c *monitor.Collector, q url.Values) (any, error) {
		return c.ReadFileText("local", local, q.Get("path"), 512*1024)
	}))

	// 操作类
	mux.HandleFunc("POST /op/kill", s.handleKill)
	mux.HandleFunc("POST /op/app-shutdown", s.handleAppShutdown)
	mux.HandleFunc("POST /op/docker", s.handleDockerAction)
	mux.HandleFunc("POST /op/delete-paths", s.handleDeletePaths)

	// 管理
	mux.HandleFunc("GET /admin/stats", s.handleAdminStats)
	mux.HandleFunc("POST /admin/cleanup", s.handleAdminCleanup)

	return s.auth(mux)
}

// auth Bearer token 校验（token 为空时全放行）
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.token != "" {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if got != s.token {
				writeErr(w, http.StatusUnauthorized, "token 无效")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// ============ 读库端点 ============

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	h := Health{
		Version:    s.version,
		UptimeSec:  int64(time.Since(s.startTime).Seconds()),
		RSSKB:      selfRSSKB(),
		CPUTimeSec: selfCPUTimeSec(),
		Written:    s.store.WrittenSamples.Load(),
		Dropped:    s.store.DroppedSamples.Load(),
		DiskLow:    s.store.stoppedLowDisk.Load(),
	}
	if v, ok := s.store.LastWriteErr.Load().(string); ok {
		h.LastWriteErr = v
	}
	writeJSON(w, http.StatusOK, h)
}

// handleCurrent 最新采样 + 静态信息（概览页轮询用，零命令执行）
func (s *Server) handleCurrent(w http.ResponseWriter, _ *http.Request) {
	cur, err := s.store.Current()
	if errors.Is(err, ErrNoData) {
		writeErr(w, http.StatusNotFound, "尚无采样数据，请稍候")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, CurrentResponse{Metrics: *cur, Info: s.hostInfo()})
}

func (s *Server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.hostInfo())
}

// hostInfo 取缓存的静态信息，超过 5 分钟刷新（读文件微秒级，不构成负担）
func (s *Server) hostInfo() HostInfo {
	s.infoMu.Lock()
	stale := time.Now().Unix()-s.info.CollectedAt > 300
	s.infoMu.Unlock()
	if stale {
		info := CollectHostInfo(s.mc.procRoot)
		s.infoMu.Lock()
		s.info = info
		s.infoMu.Unlock()
	}
	s.infoMu.Lock()
	defer s.infoMu.Unlock()
	return s.info
}

func (s *Server) handleRange(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, err1 := strconv.ParseInt(q.Get("from"), 10, 64)
	to, err2 := strconv.ParseInt(q.Get("to"), 10, 64)
	if err1 != nil || err2 != nil || from <= 0 {
		writeErr(w, http.StatusBadRequest, "from/to 需为 Unix 秒")
		return
	}
	pts, src, err := s.store.Range(r.Context(), from, to, q.Get("src"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, RangeResponse{Src: src, Points: pts})
}

func (s *Server) handleSummary(w http.ResponseWriter, _ *http.Request) {
	sums, err := s.store.Summary()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sums)
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, _ := strconv.ParseInt(q.Get("from"), 10, 64)
	if from <= 0 {
		from = time.Now().Add(-24 * time.Hour).Unix()
	}
	to, _ := strconv.ParseInt(q.Get("to"), 10, 64)
	if to <= 0 {
		to = time.Now().Add(time.Hour).Unix()
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	evs, err := s.store.Events(from, to, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, evs)
}

func (s *Server) handleWatchStatus(w http.ResponseWriter, _ *http.Request) {
	if s.watcher == nil {
		writeJSON(w, http.StatusOK, []WatchStatus{})
		return
	}
	writeJSON(w, http.StatusOK, s.watcher.StatusSnapshot())
}

func (s *Server) handleWatchInstances(w http.ResponseWriter, _ *http.Request) {
	if s.watcher == nil {
		writeJSON(w, http.StatusOK, []JavaAppInstance{})
		return
	}
	writeJSON(w, http.StatusOK, s.watcher.InstancesSnapshot())
}

func (s *Server) handleWatchRange(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, err1 := strconv.ParseInt(q.Get("from"), 10, 64)
	to, err2 := strconv.ParseInt(q.Get("to"), 10, 64)
	if err1 != nil || err2 != nil || from <= 0 {
		writeErr(w, http.StatusBadRequest, "from/to 需为 Unix 秒")
		return
	}
	pts, err := s.store.QueryJarRange(from, to, q.Get("service"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, WatchRangeResponse{Points: pts})
}

func (s *Server) handleWatchEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, _ := strconv.ParseInt(q.Get("from"), 10, 64)
	if from <= 0 {
		from = time.Now().Add(-24 * time.Hour).Unix()
	}
	to, _ := strconv.ParseInt(q.Get("to"), 10, 64)
	if to <= 0 {
		to = time.Now().Add(time.Hour).Unix()
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	evs, err := s.store.QueryWatchEvents(from, to, q.Get("service"), limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, evs)
}

func (s *Server) handleAdminWatchGet(w http.ResponseWriter, _ *http.Request) {
	if s.watcher == nil {
		writeErr(w, http.StatusNotFound, "监视未启用")
		return
	}
	b, err := os.ReadFile(watchPath(s.watcher.dataDir))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, WatchYAML{YAML: string(b)})
}

func (s *Server) handleAdminWatchPost(w http.ResponseWriter, r *http.Request) {
	if s.watcher == nil {
		writeErr(w, http.StatusNotFound, "监视未启用")
		return
	}
	var req WatchYAML
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.YAML) == "" {
		writeErr(w, http.StatusBadRequest, "需要 yaml 字段")
		return
	}
	if err := s.watcher.ReplaceYAML([]byte(req.YAML)); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ============ 按需采集：无 Collector 对应方法的特殊端点 ============

// handleHomeDir agent 以 root 运行，家目录即 $HOME（默认 /root）
func (s *Server) handleHomeDir(w http.ResponseWriter, _ *http.Request) {
	home := os.Getenv("HOME")
	if home == "" {
		home = "/root"
	}
	writeJSON(w, http.StatusOK, map[string]string{"home": home})
}

func queryInt(q url.Values, key string, def int) int {
	n, err := strconv.Atoi(q.Get(key))
	if err != nil || n <= 0 {
		return def
	}
	return n
}

// ============ 操作端点（校验逻辑与面板时期一致） ============

type killReq struct {
	PID   uint32 `json:"pid"`
	Force bool   `json:"force"`
}

func (s *Server) handleKill(w http.ResponseWriter, r *http.Request) {
	var req killReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PID == 0 {
		writeErr(w, http.StatusBadRequest, "参数无效")
		return
	}
	sig := "TERM"
	if req.Force {
		sig = "KILL"
	}
	if _, err := (localRunner{}).Run("", sshd.ConnectOption{},
		fmt.Sprintf("kill -%s %d 2>&1 || true", sig, req.PID)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.WriteEvent("info", fmt.Sprintf("面板请求结束进程 pid=%d sig=%s", req.PID, sig))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleAppShutdown(w http.ResponseWriter, r *http.Request) {
	if s.watcher == nil {
		writeErr(w, http.StatusNotFound, "监视未启用")
		return
	}
	var req AppShutdownReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "参数无效")
		return
	}
	cfg := s.watcher.Config()
	svc, ok := serviceInWatch(cfg, req.Service)
	if !ok {
		writeErr(w, http.StatusBadRequest, "未知服务")
		return
	}
	if !portInService(svc, req.Port) {
		writeErr(w, http.StatusBadRequest, "端口不在 watch.yml 配置区间")
		return
	}
	if !validScreenName(req.Screen) {
		writeErr(w, http.StatusBadRequest, "非法 screen 名")
		return
	}
	stopped, err := stopAppInstance(req.Port, req.PID, req.Screen)
	msg := fmt.Sprintf("下架 %s pid=%d port=%d screen=%s stopped=%v", req.Service, req.PID, req.Port, req.Screen, stopped)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.WriteWatchEvent(WatchEvent{
		TS:      time.Now().Unix(),
		Service: req.Service,
		Layer:   "process",
		Kind:    "shutdown",
		Msg:     msg,
	})
	s.store.WriteEvent("info", msg)
	writeJSON(w, http.StatusOK, AppShutdownResult{OK: true, Stopped: stopped, Msg: msg})
}

type dockerReq struct {
	Action    string `json:"action"`
	Container string `json:"container"`
}

func (s *Server) handleDockerAction(w http.ResponseWriter, r *http.Request) {
	var req dockerReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Container == "" {
		writeErr(w, http.StatusBadRequest, "参数无效")
		return
	}
	switch req.Action {
	case "start", "stop", "restart", "pause", "unpause":
	default:
		writeErr(w, http.StatusBadRequest, "不支持的 docker 操作: "+req.Action)
		return
	}
	// 容器名与面板侧 monitor.CollectDockerInspect 同一白名单，阻断拼注入
	if !monitor.IsValidContainerRef(req.Container) {
		writeErr(w, http.StatusBadRequest, "非法容器名")
		return
	}
	out, err := (localRunner{}).Run("", sshd.ConnectOption{},
		fmt.Sprintf("docker %s %s 2>&1", req.Action, req.Container))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.WriteEvent("info", fmt.Sprintf("面板请求 docker %s %s", req.Action, req.Container))
	writeJSON(w, http.StatusOK, map[string]string{"output": string(out)})
}

type deleteReq struct {
	Paths []string `json:"paths"`
}

// systemRoots 系统根目录黑名单（与面板时期一致）
var systemRoots = map[string]bool{
	"/": true, "/bin": true, "/boot": true, "/dev": true,
	"/etc": true, "/home": true, "/lib": true, "/lib64": true,
	"/opt": true, "/proc": true, "/root": true, "/sbin": true,
	"/sys": true, "/usr": true, "/var": true,
}

func (s *Server) handleDeletePaths(w http.ResponseWriter, r *http.Request) {
	var req deleteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Paths) == 0 {
		writeErr(w, http.StatusBadRequest, "未选择任何文件")
		return
	}
	args := make([]string, 0, len(req.Paths))
	for _, p := range req.Paths {
		c := path.Clean(p)
		if !strings.HasPrefix(c, "/") {
			writeErr(w, http.StatusBadRequest, "路径必须为绝对路径: "+p)
			return
		}
		if strings.Contains(c, "'") {
			writeErr(w, http.StatusBadRequest, "路径含非法字符: "+p)
			return
		}
		if systemRoots[c] {
			writeErr(w, http.StatusBadRequest, "禁止删除系统目录: "+c)
			return
		}
		args = append(args, "'"+c+"'")
	}
	out, err := (localRunner{}).Run("", sshd.ConnectOption{}, "rm -rf "+strings.Join(args, " "))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败: "+err.Error())
		return
	}
	s.store.WriteEvent("warn", "面板请求删除文件: "+strings.Join(req.Paths, " "))
	writeJSON(w, http.StatusOK, map[string]string{"output": string(out)})
}

// ============ 管理端点 ============

func (s *Server) handleAdminStats(w http.ResponseWriter, _ *http.Request) {
	t, err := s.store.Stats()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	dbSize, walSize := s.store.FileSizes()
	writeJSON(w, http.StatusOK, map[string]any{
		"tables":  t,
		"dbSize":  dbSize,
		"walSize": walSize,
	})
}

func (s *Server) handleAdminCleanup(w http.ResponseWriter, r *http.Request) {
	// 复用周期清理的分批限速逻辑
	c := NewCleanup(s.store, s.retention)
	var total int64
	if err := c.cleanup(r.Context(), &total); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.WriteEvent("info", fmt.Sprintf("手动清理完成，删除 %d 行", total))
	writeJSON(w, http.StatusOK, map[string]int64{"deleted": total})
}

// ============ 工具 ============

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// selfRSSKB 读 /proc/self/status 的 VmRSS（KB）；非 Linux 返回 0
func selfRSSKB() int64 {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(line, "VmRSS:"); ok {
			fields := strings.Fields(v)
			if len(fields) >= 1 {
				n, _ := strconv.ParseInt(fields[0], 10, 64)
				return n
			}
		}
	}
	return 0
}

// selfCPUTimeSec 读 /proc/self/stat 的 utime+stime（clock tick 按 100Hz 折算秒）
func selfCPUTimeSec() float64 {
	b, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0
	}
	// comm 字段可能含空格，取最后一个 ')' 之后的部分再数字段
	s := string(b)
	if i := strings.LastIndex(s, ")"); i >= 0 && i+2 <= len(s) {
		s = s[i+2:]
	}
	fields := strings.Fields(s)
	// ')' 后第 12/13 个字段是 utime/stime（原第 14/15 列）
	if len(fields) < 13 {
		return 0
	}
	utime, _ := strconv.ParseFloat(fields[11], 64)
	stime, _ := strconv.ParseFloat(fields[12], 64)
	return (utime + stime) / 100.0
}
