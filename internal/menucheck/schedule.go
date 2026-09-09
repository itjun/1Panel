package menucheck

import (
	"sync"
	"time"
)

const (
	// 本地时区每天 18:00–20:00（含 20:00 整点）每 5 分钟检查一次。
	windowStartMin = 18 * 60
	windowEndMin   = 20 * 60
	checkInterval  = 5 * time.Minute
	tickInterval   = time.Minute
)

// Snapshot 某次检查的快照（含条目元数据）。
type Snapshot struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	URL       string `json:"url"`
	OK        bool   `json:"ok"`
	HasData   bool   `json:"hasData"`
	MenuText  string `json:"menuText"`
	DataText  string `json:"dataText"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	CheckedAt int64  `json:"checkedAt"` // unix ms
	Scheduled bool   `json:"scheduled"` // true=定时任务触发
}

// AlertFn 定时检查发现问题（当前：访问不了）时回调。
type AlertFn func(snap Snapshot)

// UpdateFn 每次检查结束后回调（无论成败），供前端刷新卡片。
type UpdateFn func(snap Snapshot)

// Watcher 菜单检查定时器：窗口内按间隔拉取 URL，不打开浏览器。
type Watcher struct {
	items  []Item
	nowFn  func() time.Time
	alert  AlertFn
	update UpdateFn

	mu       sync.RWMutex
	last     map[string]Snapshot
	lastSlot string
	started  bool
}

// NewWatcher 创建监视器；items 为空则用 DefaultItems。
func NewWatcher(items []Item, onAlert AlertFn, onUpdate UpdateFn) *Watcher {
	if len(items) == 0 {
		items = DefaultItems()
	}
	return &Watcher{
		items:  append([]Item(nil), items...),
		nowFn:  time.Now,
		alert:  onAlert,
		update: onUpdate,
		last:   make(map[string]Snapshot),
	}
}

// Start 启动后台循环（只启动一次）。
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
	// 若启动时已在窗口内，立刻跑一轮，不等下一个整 5 分钟。
	now := w.nowFn()
	if InCheckWindow(now) {
		w.runSlot(now, true)
	}

	t := time.NewTicker(tickInterval)
	defer t.Stop()
	for range t.C {
		now := w.nowFn()
		if !InCheckWindow(now) {
			continue
		}
		if now.Minute()%5 != 0 {
			continue
		}
		w.runSlot(now, false)
	}
}

func (w *Watcher) runSlot(now time.Time, force bool) {
	slot := now.Format("2006-01-02 15:04")
	w.mu.Lock()
	if !force && slot == w.lastSlot {
		w.mu.Unlock()
		return
	}
	w.lastSlot = slot
	items := append([]Item(nil), w.items...)
	w.mu.Unlock()

	for _, it := range items {
		w.checkOne(it, true)
	}
}

// CheckNow 立即检查指定 id（手动点击）；id 空则检查全部。
func (w *Watcher) CheckNow(id string) []Snapshot {
	w.mu.RLock()
	items := append([]Item(nil), w.items...)
	w.mu.RUnlock()

	out := make([]Snapshot, 0, len(items))
	for _, it := range items {
		if id != "" && it.ID != id {
			continue
		}
		out = append(out, w.checkOne(it, false))
	}
	return out
}

// Latest 返回各条目最近一次检查结果。
func (w *Watcher) Latest() []Snapshot {
	w.mu.RLock()
	defer w.mu.RUnlock()
	out := make([]Snapshot, 0, len(w.items))
	for _, it := range w.items {
		if s, ok := w.last[it.ID]; ok {
			out = append(out, s)
			continue
		}
		out = append(out, Snapshot{
			ID:    it.ID,
			Label: it.Label,
			URL:   it.URL,
		})
	}
	return out
}

func (w *Watcher) checkOne(it Item, scheduled bool) Snapshot {
	r := Check(it.URL)
	snap := Snapshot{
		ID:        it.ID,
		Label:     it.Label,
		URL:       it.URL,
		OK:        r.OK,
		HasData:   r.HasData,
		MenuText:  r.MenuText,
		DataText:  r.DataText,
		Title:     r.Title,
		Message:   r.Message,
		CheckedAt: w.nowFn().UnixMilli(),
		Scheduled: scheduled,
	}

	w.mu.Lock()
	w.last[it.ID] = snap
	w.mu.Unlock()

	if w.update != nil {
		w.update(snap)
	}
	// 定时任务：菜单不可用立即本地反馈（不发企微）；有无数据只更新卡片。
	if scheduled && !snap.OK && w.alert != nil {
		w.alert(snap)
	}
	return snap
}

// InCheckWindow 本地时间是否在 [18:00, 20:00]（含两端整点分钟）。
func InCheckWindow(t time.Time) bool {
	m := t.Hour()*60 + t.Minute()
	return m >= windowStartMin && m <= windowEndMin
}

// CheckInterval 导出间隔，便于测试与文档。
func CheckInterval() time.Duration {
	return checkInterval
}
