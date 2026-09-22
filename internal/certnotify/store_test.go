package certnotify

import (
	"path/filepath"
	"testing"
)

func TestCursorRoundTrip(t *testing.T) {
	s := &Store{
		path:  filepath.Join(t.TempDir(), "cert_notify_state.json"),
		hosts: map[string]Cursor{},
	}
	if err := s.Commit(" web ", Cursor{AppliedDate: "2026-09-22", Nagging: []string{"a.example", " a.example "}}); err != nil {
		t.Fatal(err)
	}
	got := s.Get("web")
	if got.AppliedDate != "2026-09-22" || len(got.Nagging) != 1 || got.Nagging[0] != "a.example" {
		t.Fatalf("%#v", got)
	}
	if err := s.Rename("web", "web-2"); err != nil {
		t.Fatal(err)
	}
	if s.Get("web").AppliedDate != "" {
		t.Fatal("old name should be gone")
	}
	if s.Get("web-2").AppliedDate != "2026-09-22" {
		t.Fatalf("renamed=%#v", s.Get("web-2"))
	}
	if err := s.Commit("other", Cursor{AppliedDate: "2026-09-20", Nagging: []string{"b.example"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename("web-2", "other"); err != nil {
		t.Fatal(err)
	}
	merged := s.Get("other")
	if merged.AppliedDate != "2026-09-22" || len(merged.Nagging) != 2 {
		t.Fatalf("merge=%#v", merged)
	}

	s2 := &Store{path: s.path, hosts: map[string]Cursor{}}
	if err := s2.load(); err != nil {
		t.Fatal(err)
	}
	reloaded := s2.Get("other")
	if reloaded.AppliedDate != "2026-09-22" || len(reloaded.Nagging) != 2 {
		t.Fatalf("reload=%#v", reloaded)
	}
}
