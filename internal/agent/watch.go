package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	layerProcess = "process"
	layerHealth  = "health"
	layerIngress = "ingress"
)

type cpuPrev struct {
	ticks uint64
	at    time.Time
}

type layerState struct {
	up             bool
	fails          int
	lastNotifyDown time.Time
	lastNotifyUp   time.Time
	seen           bool
}

// Watcher 应用分层探活 + Actuator 采样
type Watcher struct {
	store   *Store
	dataDir string
	proc    string

	mu  sync.Mutex
	cfg WatchConfig

	cpu  map[int]cpuPrev
	st   map[string]*layerState // service/layer
	inst map[string]int
	http *http.Client

	host string
}

func NewWatcher(store *Store, dataDir string) *Watcher {
	h, _ := os.Hostname()
	cfg, err := LoadOrInitWatch(dataDir)
	if err != nil {
		log.Printf("[watch] 加载 watch.yml: %v", err)
		cfg, _ = parseWatchYAML([]byte(defaultWatchYAML))
	}
	return &Watcher{
		store:   store,
		dataDir: dataDir,
		proc:    "/proc",
		cfg:     cfg,
		cpu:     map[int]cpuPrev{},
		st:      map[string]*layerState{},
		inst:    map[string]int{},
		http:    &http.Client{Timeout: cfg.probeTimeout(), CheckRedirect: noFollowRedirect},
		host:    h,
	}
}

func noFollowRedirect(_ *http.Request, _ []*http.Request) error {
	return http.ErrUseLastResponse
}

func (w *Watcher) Config() WatchConfig {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.cfg
}

func (w *Watcher) ReplaceYAML(raw []byte) error {
	c, err := saveWatchYAML(w.dataDir, raw)
	if err != nil {
		return err
	}
	w.mu.Lock()
	w.cfg = c
	w.http = &http.Client{Timeout: c.probeTimeout(), CheckRedirect: noFollowRedirect}
	w.mu.Unlock()
	w.store.WriteEvent("info", "已更新 watch.yml")
	return nil
}

func (w *Watcher) Run(ctx context.Context) {
	w.tick()
	w.mu.Lock()
	d := w.cfg.interval()
	w.mu.Unlock()
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.mu.Lock()
			nd := w.cfg.interval()
			w.mu.Unlock()
			if nd != d {
				t.Reset(nd)
				d = nd
			}
			w.tick()
		}
	}
}

func (w *Watcher) tick() {
	w.mu.Lock()
	cfg := w.cfg
	w.mu.Unlock()
	if len(cfg.Services) == 0 {
		return
	}
	procs := scanJavaProcs(w.proc)
	now := time.Now()

	for _, svc := range cfg.Services {
		var inst []javaProc
		for _, p := range procs {
			if matchWatched(svc, p) {
				inst = append(inst, p)
			}
		}
		w.mu.Lock()
		w.inst[svc.Name] = len(inst)
		w.mu.Unlock()
		w.applyLayer(cfg, svc.Name, layerProcess, len(inst) > 0,
			fmt.Sprintf("%s 进程层：%d 个实例", svc.Name, len(inst)))

		healthAny := false
		for _, p := range inst {
			port := pickPort(p.Ports, svc.PortFrom, svc.PortTo)
			hs := JarSample{
				TS: now.Unix(), Service: svc.Name, PID: p.PID, Port: port,
				RSS: p.RSS, CPUPercent: w.cpuPct(p.PID, p.CPUTicks, now),
			}
			if port > 0 && svc.HealthPath != "" {
				ok, heapUsed, heapMax, pause := w.scrape(cfg, port, svc)
				hs.HealthOK = ok
				hs.HeapUsed = heapUsed
				hs.HeapMax = heapMax
				hs.GCPauseMs = pause
				if ok {
					healthAny = true
				}
				if pause >= cfg.GCPauseMarkMs && pause > 0 {
					w.store.WriteWatchEvent(WatchEvent{
						TS: now.Unix(), Service: svc.Name, Layer: "gc", Kind: "spike",
						Msg: fmt.Sprintf("%s GC pause %.0fms pid=%d", svc.Name, pause, p.PID),
					})
				}
			}
			cp := hs
			w.store.EnqueueJar(&cp)
		}
		if len(inst) == 0 {
			w.applyLayer(cfg, svc.Name, layerHealth, false, svc.Name+" 本机探活：无进程")
		} else {
			w.applyLayer(cfg, svc.Name, layerHealth, healthAny,
				fmt.Sprintf("%s 本机探活：健康实例 %v", svc.Name, healthAny))
		}

		if svc.Ingress.Enabled && svc.Ingress.URL != "" {
			ok, code, err := w.probeIngress(cfg, svc.Ingress)
			msg := fmt.Sprintf("%s 入口层 HTTP %d", svc.Name, code)
			if err != nil {
				msg = fmt.Sprintf("%s 入口层失败: %v", svc.Name, err)
			}
			w.applyLayer(cfg, svc.Name, layerIngress, ok, msg)
		}
	}
}

func pickPort(ports []int, from, to int) int {
	for _, p := range ports {
		if p >= from && p <= to {
			return p
		}
	}
	if len(ports) > 0 {
		return ports[0]
	}
	return 0
}

func (w *Watcher) cpuPct(pid int, ticks uint64, now time.Time) float64 {
	prev, ok := w.cpu[pid]
	w.cpu[pid] = cpuPrev{ticks: ticks, at: now}
	if !ok || now.Sub(prev.at) <= 0 {
		return 0
	}
	dt := now.Sub(prev.at).Seconds()
	if dt <= 0 {
		return 0
	}
	pct := float64(ticks-prev.ticks) / 100.0 / dt * 100
	if pct < 0 {
		return 0
	}
	if pct > 800 {
		return 800
	}
	return pct
}

func (w *Watcher) scrape(cfg WatchConfig, port int, svc ServiceWatch) (ok bool, heapUsed, heapMax uint64, pauseMs float64) {
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	path := svc.HealthPath
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	ctx, cancel := context.WithTimeout(context.Background(), cfg.probeTimeout())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if err != nil {
		return false, 0, 0, 0
	}
	resp, err := w.http.Do(req)
	if err != nil {
		return false, 0, 0, 0
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, 0, 0, 0
	}
	var hb struct {
		Status string `json:"status"`
		OK     *bool  `json:"ok"`
	}
	_ = json.Unmarshal(body, &hb)
	ok = true
	if hb.Status != "" && !strings.EqualFold(hb.Status, "UP") {
		ok = false
	}
	if hb.OK != nil && !*hb.OK {
		ok = false
	}
	if !svc.ScrapeMetrics {
		return ok, 0, 0, 0
	}
	heapUsed = w.metricValue(cfg, base+"/actuator/metrics/jvm.memory.used?tag=area:heap", "VALUE")
	heapMax = w.metricValue(cfg, base+"/actuator/metrics/jvm.memory.max?tag=area:heap", "VALUE")
	pauseSec := w.metricValueFloat(cfg, base+"/actuator/metrics/jvm.gc.pause", "MAX")
	return ok, heapUsed, heapMax, pauseSec * 1000
}

func (w *Watcher) metricValue(cfg WatchConfig, url, stat string) uint64 {
	return uint64(w.metricValueFloat(cfg, url, stat))
}

func (w *Watcher) metricValueFloat(cfg WatchConfig, url, stat string) float64 {
	ctx, cancel := context.WithTimeout(context.Background(), cfg.probeTimeout())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0
	}
	resp, err := w.http.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return 0
	}
	var m struct {
		Measurements []struct {
			Statistic string  `json:"statistic"`
			Value     float64 `json:"value"`
		} `json:"measurements"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(&m) != nil {
		return 0
	}
	for _, x := range m.Measurements {
		if strings.EqualFold(x.Statistic, stat) {
			return x.Value
		}
	}
	return 0
}

func (w *Watcher) probeIngress(cfg WatchConfig, in IngressProbe) (bool, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cfg.probeTimeout())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, in.URL, nil)
	if err != nil {
		return false, 0, err
	}
	if in.HostHeader != "" {
		req.Host = in.HostHeader
		req.Header.Set("Host", in.HostHeader)
	}
	resp, err := w.http.Do(req)
	if err != nil {
		return false, 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 8<<10))
	code := resp.StatusCode
	if code >= 200 && code < 500 {
		return true, code, nil
	}
	return false, code, fmt.Errorf("HTTP %d", code)
}

func (w *Watcher) applyLayer(cfg WatchConfig, service, layer string, up bool, detail string) {
	key := service + "/" + layer
	st := w.st[key]
	if st == nil {
		st = &layerState{}
		w.st[key] = st
	}
	now := time.Now()
	if up {
		st.fails = 0
		if st.seen && !st.up {
			w.transition(cfg, service, layer, "up", detail, now, st)
		}
		st.up = true
		st.seen = true
		return
	}
	st.fails++
	if st.fails < cfg.FailStreak {
		return
	}
	if st.seen && st.up {
		w.transition(cfg, service, layer, "down", detail, now, st)
	} else if !st.seen {
		w.transition(cfg, service, layer, "down", detail, now, st)
	}
	st.up = false
	st.seen = true
}

func (w *Watcher) transition(cfg WatchConfig, service, layer, kind, detail string, now time.Time, st *layerState) {
	msg := fmt.Sprintf("[%s] %s %s %s · %s", w.host, service, layerName(layer), kindName(kind), detail)
	w.store.WriteWatchEvent(WatchEvent{TS: now.Unix(), Service: service, Layer: layer, Kind: kind, Msg: msg})
	var last *time.Time
	if kind == "up" {
		last = &st.lastNotifyUp
	} else {
		last = &st.lastNotifyDown
	}
	if !last.IsZero() && now.Sub(*last) < time.Duration(cfg.DedupSec)*time.Second {
		return
	}
	*last = now
	if err := notifyWecom(cfg.WecomWebhook, msg); err != nil {
		log.Printf("[watch] 企微: %v", err)
		w.store.WriteEvent("warn", "企微发送失败: "+err.Error())
	}
}

func layerName(l string) string {
	switch l {
	case layerProcess:
		return "进程层"
	case layerHealth:
		return "本机探活"
	case layerIngress:
		return "入口层"
	default:
		return l
	}
}

func kindName(k string) string {
	if k == "up" {
		return "恢复"
	}
	return "挂了"
}

// WatchStatus 当前各服务分层状态（给面板卡片）
type WatchStatus struct {
	Service   string `json:"service"`
	Runtime   string `json:"runtime"`
	ProcessUp bool   `json:"processUp"`
	HealthUp  bool   `json:"healthUp"`
	IngressUp bool   `json:"ingressUp"`
	IngressOn bool   `json:"ingressOn"`
	Instances int    `json:"instances"`
}

func (w *Watcher) StatusSnapshot() []WatchStatus {
	w.mu.Lock()
	cfg := w.cfg
	w.mu.Unlock()
	out := make([]WatchStatus, 0, len(cfg.Services))
	for _, svc := range cfg.Services {
		rt := svc.Runtime
		if rt == "" {
			rt = "java"
		}
		ws := WatchStatus{Service: svc.Name, Runtime: rt, IngressOn: svc.Ingress.Enabled, Instances: w.inst[svc.Name]}
		if st := w.st[svc.Name+"/"+layerProcess]; st != nil {
			ws.ProcessUp = st.up
		}
		if st := w.st[svc.Name+"/"+layerHealth]; st != nil {
			ws.HealthUp = st.up
		}
		if st := w.st[svc.Name+"/"+layerIngress]; st != nil {
			ws.IngressUp = st.up
		}
		out = append(out, ws)
	}
	return out
}
