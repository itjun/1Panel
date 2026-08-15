package hosticon

import (
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	return &Store{
		path: filepath.Join(t.TempDir(), "host_icons.json"),
		data: map[string]*Record{},
	}
}

func TestPutGetAndReload(t *testing.T) {
	s := newTestStore(t)
	if err := s.Put("cdcp-beta", `Ubuntu 22.04.5 LTS`); err != nil {
		t.Fatal(err)
	}
	rec, ok := s.Get("cdcp-beta")
	if !ok {
		t.Fatal("expected record")
	}
	if rec.OSRelease != "Ubuntu 22.04.5 LTS" {
		t.Fatalf("osRelease = %q", rec.OSRelease)
	}
	if rec.UpdatedAt == 0 {
		t.Fatal("updatedAt should be set")
	}

	s2 := &Store{path: s.path, data: map[string]*Record{}}
	if err := s2.load(); err != nil {
		t.Fatal(err)
	}
	rec2, ok := s2.Get("cdcp-beta")
	if !ok || rec2.OSRelease != "Ubuntu 22.04.5 LTS" {
		t.Fatalf("reload failed: ok=%v rec=%#v", ok, rec2)
	}
}

func TestPutSameValueSkipsRewrite(t *testing.T) {
	s := newTestStore(t)
	if err := s.Put("a", "Debian GNU/Linux 12 (bookworm)"); err != nil {
		t.Fatal(err)
	}
	first, _ := s.Get("a")
	if err := s.Put("a", "Debian GNU/Linux 12 (bookworm)"); err != nil {
		t.Fatal(err)
	}
	second, _ := s.Get("a")
	if first.UpdatedAt != second.UpdatedAt {
		t.Fatalf("unchanged put should not bump updatedAt: %d vs %d", first.UpdatedAt, second.UpdatedAt)
	}
}

func TestPutRejectsEmpty(t *testing.T) {
	s := newTestStore(t)
	if err := s.Put("", "Ubuntu"); err == nil {
		t.Fatal("expected empty host error")
	}
	if err := s.Put("a", ""); err == nil {
		t.Fatal("expected empty osRelease error")
	}
}

func TestRenameAndDelete(t *testing.T) {
	s := newTestStore(t)
	_ = s.Put("old", "Ubuntu 24.04 LTS")
	if err := s.Rename("old", "new"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get("old"); ok {
		t.Fatal("old name should be gone")
	}
	rec, ok := s.Get("new")
	if !ok || rec.OSRelease != "Ubuntu 24.04 LTS" {
		t.Fatalf("rename failed: %#v", rec)
	}

	if err := s.Delete("new"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get("new"); ok {
		t.Fatal("delete failed")
	}

	// 落盘后再读，确认已删除
	s2 := &Store{path: s.path, data: map[string]*Record{}}
	if err := s2.load(); err != nil {
		t.Fatal(err)
	}
	if _, ok := s2.Get("new"); ok {
		t.Fatal("deleted record survived reload")
	}
}

func TestRenameMissingIsNoop(t *testing.T) {
	s := newTestStore(t)
	if err := s.Rename("ghost", "next"); err != nil {
		t.Fatal(err)
	}
	if n := len(s.List()); n != 0 {
		t.Fatalf("want empty, got %d", n)
	}
}
