package alerthistory

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreAppendCapAndRead(t *testing.T) {
	dir := t.TempDir()
	// NewStore 用 UserConfigDir；这里直接构造指向临时文件
	s := &Store{
		path:   filepath.Join(dir, "alert_history.json"),
		events: nil,
	}

	for i := 0; i < 5; i++ {
		_, err := s.Append(Event{
			Host:  "h1",
			Kind:  "cpu",
			State: "down",
			Title: "t",
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := s.UnreadCount(); got != 5 {
		t.Fatalf("UnreadCount=%d want 5", got)
	}
	list := s.List(2)
	if len(list) != 2 {
		t.Fatalf("List(2) len=%d", len(list))
	}
	if err := s.MarkRead(list[0].ID); err != nil {
		t.Fatal(err)
	}
	if got := s.UnreadCount(); got != 4 {
		t.Fatalf("after MarkRead UnreadCount=%d want 4", got)
	}
	if err := s.MarkAllRead("h1"); err != nil {
		t.Fatal(err)
	}
	if got := s.UnreadCount(); got != 0 {
		t.Fatalf("after MarkAllRead UnreadCount=%d want 0", got)
	}

	// 重新加载
	s2 := &Store{path: s.path}
	if err := s2.load(); err != nil {
		t.Fatal(err)
	}
	if len(s2.events) != 5 {
		t.Fatalf("reload len=%d", len(s2.events))
	}
	_ = os.Remove(s.path)
}

func TestAppendIncidentDefaultsToOwnID(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), historyFile)}
	down, err := s.Append(Event{Host: "h", Kind: "cpu", State: "down", Value: " 93.4% "})
	if err != nil {
		t.Fatal(err)
	}
	if down.IncidentID != down.ID || down.Value != "93.4%" || down.Channels == nil {
		t.Fatalf("down=%#v", down)
	}
	up, err := s.Append(Event{Host: "h", Kind: "cpu", State: "up", IncidentID: down.ID})
	if err != nil {
		t.Fatal(err)
	}
	if up.IncidentID != down.ID {
		t.Fatalf("up incident=%q want %q", up.IncidentID, down.ID)
	}
}

func TestStoreMaxEvents(t *testing.T) {
	dir := t.TempDir()
	s := &Store{path: filepath.Join(dir, "alert_history.json")}
	old := maxEvents
	// 用真实常量测：追加超过上限后长度封顶
	for i := 0; i < maxEvents+10; i++ {
		_, err := s.Append(Event{Host: "h", Kind: "mem", State: "down", Title: "x"})
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(s.events) != old {
		t.Fatalf("len=%d want %d", len(s.events), old)
	}
}
