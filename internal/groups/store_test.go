package groups

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNestingMoveAndCascadeDelete(t *testing.T) {
	dir := t.TempDir()
	// 把 UserConfigDir 指到 temp：NewStore 用 UserConfigDir+appName
	// 这里直接构造 Store 绕过 UserConfigDir
	s := &Store{
		path: filepath.Join(dir, "groups.json"),
		data: map[string]*Group{},
	}

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}

	must(s.Upsert(Group{ID: "root", Name: "root", Order: 1, Hosts: []string{"h1"}}))
	must(s.Upsert(Group{ID: "child", Name: "child", ParentID: "root", Order: 1, Hosts: []string{"h2"}}))
	must(s.Upsert(Group{ID: "grand", Name: "grand", ParentID: "child", Order: 1, Hosts: []string{"h3"}}))

	if d := s.Depth("grand"); d != 3 {
		t.Fatalf("grand depth=%d want 3", d)
	}
	// 第 4 层应失败
	err := s.Upsert(Group{ID: "too", Name: "too", ParentID: "grand", Hosts: []string{}})
	if err == nil {
		t.Fatal("expected depth error")
	}

	names := s.SubtreeHostNames("root")
	if len(names) != 3 {
		t.Fatalf("subtree hosts=%v", names)
	}

	stats, err := s.PreviewDelete("child")
	must(err)
	if stats.GroupCount != 2 || stats.HostCount != 2 {
		t.Fatalf("stats=%+v", stats)
	}

	must(s.Delete("child"))
	if _, err := os.Stat(s.path); err != nil {
		t.Fatal(err)
	}
	if len(s.List()) != 1 {
		t.Fatalf("after delete list=%v", s.List())
	}
	if len(s.List()[0].Hosts) != 1 || s.List()[0].Hosts[0] != "h1" {
		t.Fatalf("root hosts=%v", s.List()[0].Hosts)
	}
}

func TestMoveGroupRejectCycle(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "g.json"), data: map[string]*Group{}}
	_ = s.Upsert(Group{ID: "a", Name: "a", Hosts: []string{}})
	_ = s.Upsert(Group{ID: "b", Name: "b", ParentID: "a", Hosts: []string{}})
	if err := s.MoveGroup("a", "b"); err == nil {
		t.Fatal("expected cycle error")
	}
}
