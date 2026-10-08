package appsession

import (
	"path/filepath"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time { return c.t }

func newTestStore(t *testing.T, path string, clk *fakeClock) *Store {
	t.Helper()
	s, err := newStoreAt(path, clk.now)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNormalEnd(t *testing.T) {
	path := filepath.Join(t.TempDir(), sessionsFile)
	clk := &fakeClock{t: time.Date(2026, 10, 4, 9, 0, 0, 0, time.Local)}
	s := newTestStore(t, path, clk)
	if _, err := s.Begin("1.0.0"); err != nil {
		t.Fatal(err)
	}
	clk.t = clk.t.Add(90 * time.Minute)
	if err := s.End(); err != nil {
		t.Fatal(err)
	}
	if err := s.End(); err != nil {
		t.Fatal(err)
	}

	list := newTestStore(t, path, clk).List(0)
	if len(list) != 1 {
		t.Fatalf("len = %d", len(list))
	}
	got := list[0]
	if got.EndReason != EndNormal || got.DurationSec != 5400 || got.Version != "1.0.0" {
		t.Fatalf("unexpected session: %+v", got)
	}
}

func TestAbnormalRecoveredOnNextBegin(t *testing.T) {
	path := filepath.Join(t.TempDir(), sessionsFile)
	clk := &fakeClock{t: time.Date(2026, 10, 4, 9, 0, 0, 0, time.Local)}
	s := newTestStore(t, path, clk)
	if _, err := s.Begin(""); err != nil {
		t.Fatal(err)
	}
	clk.t = clk.t.Add(10 * time.Minute)
	if err := s.Heartbeat(); err != nil {
		t.Fatal(err)
	}

	// 进程被强杀：不调用 End，直接重新打开
	clk.t = clk.t.Add(2 * time.Hour)
	s2 := newTestStore(t, path, clk)
	if _, ok := s2.Current(); ok {
		t.Fatal("reopened store should have no current session")
	}
	if _, err := s2.Begin(""); err != nil {
		t.Fatal(err)
	}
	list := s2.List(0)
	if len(list) != 2 {
		t.Fatalf("len = %d", len(list))
	}
	if list[0].EndAt != 0 {
		t.Fatalf("new session should be running: %+v", list[0])
	}
	prev := list[1]
	if prev.EndReason != EndAbnormal || prev.DurationSec != 600 {
		t.Fatalf("unexpected recovered session: %+v", prev)
	}
	cur, ok := s2.Current()
	if !ok || cur.ID != list[0].ID {
		t.Fatalf("current mismatch: %+v", cur)
	}
}

func TestTrimAndClearKeepsCurrent(t *testing.T) {
	old := maxSessions
	maxSessions = 5
	t.Cleanup(func() { maxSessions = old })
	path := filepath.Join(t.TempDir(), sessionsFile)
	clk := &fakeClock{t: time.Date(2026, 1, 1, 0, 0, 0, 0, time.Local)}
	s := newTestStore(t, path, clk)
	for i := 0; i < maxSessions+3; i++ {
		clk.t = clk.t.Add(time.Minute)
		if _, err := s.Begin(""); err != nil {
			t.Fatal(err)
		}
		if i < maxSessions+2 {
			clk.t = clk.t.Add(time.Second)
			if err := s.End(); err != nil {
				t.Fatal(err)
			}
		}
	}
	if n := len(s.List(0)); n != maxSessions {
		t.Fatalf("len = %d, want %d", n, maxSessions)
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	list := s.List(0)
	if len(list) != 1 || list[0].EndAt != 0 {
		t.Fatalf("clear should keep current only: %+v", list)
	}
}
