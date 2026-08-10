package groups

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRenamePreservesHosts(t *testing.T) {
	dir := t.TempDir()
	// 绕过 UserConfigDir：直接构造 store 路径
	s := &Store{
		path: filepath.Join(dir, "groups.json"),
		data: map[string]*Group{},
	}
	if err := s.Upsert(Group{
		ID:    "cdcp",
		Name:  "CDCP 集群",
		Order: 1,
		Hosts: []string{"a", "b", "c"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename("cdcp", "CDCP生产"); err != nil {
		t.Fatal(err)
	}
	list := s.List()
	if len(list) != 1 {
		t.Fatalf("want 1 group, got %d", len(list))
	}
	if list[0].Name != "CDCP生产" {
		t.Fatalf("name = %q", list[0].Name)
	}
	if len(list[0].Hosts) != 3 {
		t.Fatalf("hosts wiped: %#v", list[0].Hosts)
	}

	// 落盘再读
	s2 := &Store{path: s.path, data: map[string]*Group{}}
	if err := s2.load(); err != nil {
		t.Fatal(err)
	}
	list2 := s2.List()
	if list2[0].Name != "CDCP生产" || len(list2[0].Hosts) != 3 {
		t.Fatalf("reload failed: %#v", list2[0])
	}
	_ = os.Remove(s.path)
}

func TestRenameRejectsDuplicate(t *testing.T) {
	dir := t.TempDir()
	s := &Store{path: filepath.Join(dir, "groups.json"), data: map[string]*Group{}}
	_ = s.Upsert(Group{ID: "a", Name: "一组", Hosts: []string{"h1"}})
	_ = s.Upsert(Group{ID: "b", Name: "二组", Hosts: []string{"h2"}})
	if err := s.Rename("a", "二组"); err == nil {
		t.Fatal("expected duplicate name error")
	}
}

func TestUpsertKeepsHostsWhenNil(t *testing.T) {
	dir := t.TempDir()
	s := &Store{path: filepath.Join(dir, "groups.json"), data: map[string]*Group{}}
	_ = s.Upsert(Group{ID: "g1", Name: "原名", Hosts: []string{"x", "y"}})
	// 模拟前端只改名、hosts 未传
	if err := s.Upsert(Group{ID: "g1", Name: "新名", Hosts: nil}); err != nil {
		t.Fatal(err)
	}
	g := s.List()[0]
	if g.Name != "新名" || len(g.Hosts) != 2 {
		t.Fatalf("got name=%q hosts=%v", g.Name, g.Hosts)
	}
}
