package menucheck

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

const tickInterval = time.Minute

// Snapshot 某个巡检项最近一次检查结果（含当前配置，便于前端编辑回填）。
type Snapshot struct {
	Result
	ID        string `json:"id"`
	Label     string `json:"label"`
	Method    string `json:"method"`
	URL       string `json:"url"` // 已拼接启用的 Query
	CheckedAt int64  `json:"checkedAt"` // unix ms；0 表示尚未检查
	Scheduled bool   `json:"scheduled"` // true=定时任务触发
	Item      Item   `json:"item"`
}

// AlertFn 定时检查失败（请求或内容任一异常）时回调，每次失败都会调用。
type AlertFn func(snap Snapshot)

// UpdateFn 每次检查结束后回调（无论成败），供前端刷新卡片。
type UpdateFn func(snap Snapshot)

// Watcher 巡检调度：每分钟检查一次哪些项到点，用 Go HTTP 执行，不打开浏览器。
type Watcher struct {
	store  *Store
	nowFn  func() time.Time
	alert  AlertFn
	update UpdateFn

	mu      sync.RWMutex
	last    map[string]Snapshot
	lastRun map[string]time.Time // 定时任务上次执行的时间（仅定时触发会更新）
	running map[string]bool
	started bool
}

// NewWatcher 创建调度器；巡检项每次都从 store 读取，编辑后立即生效。
func NewWatcher(store *Store, onAlert AlertFn, onUpdate UpdateFn) *Watcher {
	return &Watcher{
		store:   store,
		nowFn:   time.Now,
		alert:   onAlert,
		update:  onUpdate,
		last:    make(map[string]Snapshot),
		lastRun: make(map[string]time.Time),
		running: make(map[string]bool),
	}
}

// Start 启动后台循环（只启动一次）。启动时已在时间窗内的项会立即跑一轮。
func (w *Watcher) Start() {
	w.mu.Lock()
	if w.started {
		w.mu.Unlock()
		return
	}
	w.started = true
	w.mu.Unlock()

	go w.loop()
}

func (w *Watcher) loop() {
	w.tick(w.nowFn())
	t := time.NewTicker(tickInterval)
	defer t.Stop()
	for range t.C {
		w.tick(w.nowFn())
	}
}

// tick 找出到点的项并发执行；同一项上一轮还没结束时跳过。
func (w *Watcher) tick(now time.Time) {
	for _, it := range w.dueItems(now) {
		go w.checkOne(it, true)
	}
}

func (w *Watcher) dueItems(now time.Time) []Item {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []Item
	for _, it := range w.store.List() {
		if !it.ScheduleEnabled || !InWindow(it, now) || w.running[it.ID] {
			continue
		}
		if !isDue(w.lastRun[it.ID], now, it.IntervalMin) {
			continue
		}
		w.lastRun[it.ID] = now
		w.running[it.ID] = true
		out = append(out, it)
	}
	return out
}

// isDue 按分钟粒度比较，避免 ticker 抖动几秒导致整轮被跳过。
func isDue(last, now time.Time, intervalMin int) bool {
	if last.IsZero() {
		return true
	}
	elapsed := now.Truncate(time.Minute).Sub(last.Truncate(time.Minute))
	return elapsed >= time.Duration(intervalMin)*time.Minute
}

// CheckNow 立即检查指定 id（手动点击，不告警）；id 空则检查全部。
func (w *Watcher) CheckNow(id string) []Snapshot {
	items := w.store.List()
	out := make([]Snapshot, 0, len(items))
	for _, it := range items {
		if id != "" && it.ID != id {
			continue
		}
		out = append(out, w.checkOne(it, false))
	}
	return out
}

// Test 用未保存的配置试发一次，不记录、不告警。
func (w *Watcher) Test(it Item) Snapshot {
	it = Normalize(it)
	return w.snapshot(it, Check(it), false)
}

// Forget 删除巡检项后清掉其运行状态。
func (w *Watcher) Forget(id string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.last, id)
	delete(w.lastRun, id)
}

// Latest 返回各项最近一次结果；配置取最新值。
func (w *Watcher) Latest() []Snapshot {
	items := w.store.List()
	w.mu.RLock()
	defer w.mu.RUnlock()
	out := make([]Snapshot, 0, len(items))
	for _, it := range items {
		s, ok := w.last[it.ID]
		if !ok {
			s = Snapshot{}
		}
		out = append(out, withItem(s, it))
	}
	return out
}

func (w *Watcher) checkOne(it Item, scheduled bool) Snapshot {
	if scheduled {
		defer func() {
			w.mu.Lock()
			delete(w.running, it.ID)
			w.mu.Unlock()
		}()
	}
	snap := w.snapshot(it, Check(it), scheduled)

	w.mu.Lock()
	w.last[it.ID] = snap
	w.mu.Unlock()

	if w.update != nil {
		w.update(snap)
	}
	if scheduled && !snap.Passed() && w.alert != nil {
		w.alert(snap)
	}
	return snap
}

func (w *Watcher) snapshot(it Item, r Result, scheduled bool) Snapshot {
	s := withItem(Snapshot{Result: r}, it)
	s.CheckedAt = w.nowFn().UnixMilli()
	s.Scheduled = scheduled
	return s
}

func withItem(s Snapshot, it Item) Snapshot {
	s.ID = it.ID
	s.Label = it.Label
	s.Method = it.Method
	s.URL = it.URL
	if u, err := BuildURL(it); err == nil {
		s.URL = u.String()
	}
	s.Item = cloneItem(it)
	return s
}

// InWindow 当前本地时间是否在该项的每日时间窗内（两端含）；未配置时间窗视为全天。
func InWindow(it Item, t time.Time) bool {
	if it.WindowStart == "" && it.WindowEnd == "" {
		return true
	}
	start, err1 := parseClock(it.WindowStart)
	end, err2 := parseClock(it.WindowEnd)
	if err1 != nil || err2 != nil {
		return false
	}
	m := t.Hour()*60 + t.Minute()
	if start <= end {
		return m >= start && m <= end
	}
	return m >= start || m <= end
}

// parseClock "HH:MM" → 当天分钟数。
func parseClock(s string) (int, error) {
	h, m, ok := strings.Cut(strings.TrimSpace(s), ":")
	if !ok {
		return 0, fmt.Errorf("格式应为 HH:MM")
	}
	hh, err := strconv.Atoi(h)
	if err != nil || hh < 0 || hh > 23 {
		return 0, fmt.Errorf("小时应为 0–23")
	}
	mm, err := strconv.Atoi(m)
	if err != nil || mm < 0 || mm > 59 {
		return 0, fmt.Errorf("分钟应为 0–59")
	}
	return hh*60 + mm, nil
}
