package menucheck

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func at(h, m int) time.Time {
	return time.Date(2026, 9, 9, h, m, 0, 0, time.Local)
}

func TestInWindow(t *testing.T) {
	day := Item{WindowStart: "18:00", WindowEnd: "20:00"}
	night := Item{WindowStart: "23:00", WindowEnd: "01:30"}
	cases := []struct {
		it   Item
		h, m int
		want bool
	}{
		{day, 17, 59, false},
		{day, 18, 0, true},
		{day, 20, 0, true},
		{day, 20, 1, false},
		{night, 23, 30, true},
		{night, 0, 45, true},
		{night, 1, 31, false},
		{night, 12, 0, false},
		{Item{}, 3, 0, true},
	}
	for _, c := range cases {
		if got := InWindow(c.it, at(c.h, c.m)); got != c.want {
			t.Fatalf("%+v %02d:%02d got %v want %v", c.it, c.h, c.m, got, c.want)
		}
	}
}

func TestIsDue(t *testing.T) {
	base := at(18, 0)
	if !isDue(time.Time{}, base, 5) {
		t.Fatal("first run should be due")
	}
	if isDue(base, base.Add(4*time.Minute+59*time.Second), 5) {
		t.Fatal("4m59s should not be due")
	}
	// ticker 晚几秒、早几秒都按分钟对齐
	if !isDue(base.Add(3*time.Second), base.Add(5*time.Minute+1*time.Second), 5) {
		t.Fatal("5 minutes should be due")
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(filepath.Join(t.TempDir(), storeFile))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestStorePersistsWithPrivatePerm(t *testing.T) {
	s := newTestStore(t)
	saved, err := s.Upsert(Item{Label: "a", URL: "https://example.com", Headers: []KV{{Key: "Token", Value: "x", Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || saved.Method != "GET" || saved.IntervalMin != defaultIntervalMin {
		t.Fatalf("%+v", saved)
	}
	info, err := os.Stat(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("perm=%o", perm)
	}
	again, err := OpenStore(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if got := again.List(); len(got) != 1 || got[0].Headers[0].Value != "x" {
		t.Fatalf("%+v", got)
	}
	if _, err := s.Upsert(Item{Label: "b", URL: "https://x", WindowStart: "18:00"}); err == nil {
		t.Fatal("half window should be rejected")
	}
	if err := s.Delete(saved.ID); err != nil || len(s.List()) != 0 {
		t.Fatalf("delete err=%v list=%+v", err, s.List())
	}
}

// 定时检查每次失败都告警；手动检查不告警；成功不告警。
func TestWatcherAlertsEveryScheduledFailure(t *testing.T) {
	var mu sync.Mutex
	fail := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if fail {
			w.WriteHeader(http.StatusBadGateway)
		}
	}))
	defer srv.Close()

	s := newTestStore(t)
	it, err := s.Upsert(Item{Label: "a", URL: srv.URL, ScheduleEnabled: true, IntervalMin: 5, WindowStart: "18:00", WindowEnd: "20:00"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Upsert(Item{Label: "off", URL: srv.URL}); err != nil {
		t.Fatal(err)
	}

	alerts := 0
	w := NewWatcher(s, func(Snapshot) { alerts++ }, nil)
	run := func(now time.Time) {
		for _, due := range w.dueItems(now) {
			w.checkOne(due, true)
		}
	}

	run(at(17, 55)) // 窗口外
	run(at(18, 0))
	run(at(18, 3)) // 未到间隔
	run(at(18, 5))
	if alerts != 2 {
		t.Fatalf("want 2 alerts, got %d", alerts)
	}

	w.CheckNow(it.ID)
	if alerts != 2 {
		t.Fatalf("manual check should not alert, got %d", alerts)
	}

	mu.Lock()
	fail = false
	mu.Unlock()
	run(at(18, 10))
	if alerts != 2 {
		t.Fatalf("success should not alert, got %d", alerts)
	}
	latest := w.Latest()
	if len(latest) != 2 || !latest[0].Passed() || !latest[0].Scheduled {
		t.Fatalf("%+v", latest)
	}
}
