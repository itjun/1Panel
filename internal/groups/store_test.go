package groups

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFlatOnlyRejectsNesting(t *testing.T) {
	dir := t.TempDir()
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
	must(s.Upsert(Group{ID: "other", Name: "other", Order: 2, Hosts: []string{"h2"}}))

	// 不允许创建子分组
	err := s.Upsert(Group{ID: "child", Name: "child", ParentID: "root", Hosts: []string{"h3"}})
	if err == nil {
		t.Fatal("expected depth error when creating nested group")
	}

	// 不允许把分组移到另一分组下
	if err := s.MoveGroup("other", "root"); err == nil {
		t.Fatal("expected depth error when nesting via MoveGroup")
	}

	if len(s.List()) != 2 {
		t.Fatalf("list=%v want 2 top-level groups", s.List())
	}
}

func TestLoadFlattensNestedGroups(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "groups.json")
	raw := `[
  {"id":"root","name":"root","order":1,"hosts":["h1"]},
  {"id":"child","name":"child","parentId":"root","order":1,"hosts":["h2"]}
]`
	if err := os.WriteFile(path, []byte(raw), 0644); err != nil {
		t.Fatal(err)
	}
	s := &Store{path: path, data: map[string]*Group{}}
	if err := s.load(); err != nil {
		t.Fatal(err)
	}
	child, ok := s.data["child"]
	if !ok {
		t.Fatal("child missing")
	}
	if child.ParentID != "" {
		t.Fatalf("child ParentID=%q want empty after flatten", child.ParentID)
	}
}

func TestMoveGroupRejectSelfParent(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "g.json"), data: map[string]*Group{}}
	_ = s.Upsert(Group{ID: "a", Name: "a", Hosts: []string{}})
	_ = s.Upsert(Group{ID: "b", Name: "b", Hosts: []string{}})
	if err := s.MoveGroup("a", "a"); err == nil {
		t.Fatal("expected self-parent error")
	}
}

func TestRenamePreservesHostsAndMigratesReferences(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "g.json"), data: map[string]*Group{}}
	if err := s.Upsert(Group{ID: "03-zhetai", Name: "03-zhetai", Order: 4, Hosts: []string{"zhetai-postgres", "sshm-website"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Upsert(Group{ID: "02-private", Name: "02-private", Order: 5, Hosts: []string{}}); err != nil {
		t.Fatal(err)
	}

	if err := s.Rename("03-zhetai", "03-zhetai-main"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.data["03-zhetai"]; ok {
		t.Fatal("old group ID was retained after rename")
	}
	got, ok := s.data["03-zhetai-main"]
	if !ok {
		t.Fatal("renamed group is missing")
	}
	if got.Name != "03-zhetai-main" || len(got.Hosts) != 2 || got.Hosts[0] != "zhetai-postgres" || got.Hosts[1] != "sshm-website" {
		t.Fatalf("rename lost group metadata: %#v", got)
	}
}

func TestReorderGroups(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "g.json"), data: map[string]*Group{}}
	// 故意用乱序 order 创建，模拟历史数据
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(s.Upsert(Group{ID: "n1", Name: "n1", Order: 9, Hosts: []string{}}))
	must(s.Upsert(Group{ID: "n2", Name: "n2", Order: 1, Hosts: []string{}}))
	must(s.Upsert(Group{ID: "n3", Name: "n3", Order: 4, Hosts: []string{}}))

	// 拖拽重排为 n3, n1, n2
	if err := s.ReorderGroups("", []string{"n3", "n1", "n2"}); err != nil {
		t.Fatal(err)
	}
	got := s.List()
	if len(got) != 3 {
		t.Fatalf("len=%d want 3", len(got))
	}
	wantOrder := []string{"n3", "n1", "n2"}
	for i, g := range got {
		if g.ID != wantOrder[i] {
			t.Fatalf("idx=%d id=%s want %s", i, g.ID, wantOrder[i])
		}
		if g.Order != i {
			t.Fatalf("id=%s order=%d want %d", g.ID, g.Order, i)
		}
	}

	// 未出现在列表中的分组（如新分组创建后）追加到末尾，不报错
	must(s.Upsert(Group{ID: "n4", Name: "n4", Hosts: []string{}}))
	if err := s.ReorderGroups("", []string{"n4", "n1"}); err != nil {
		t.Fatal(err)
	}
	got = s.List()
	wantOrder = []string{"n4", "n1", "n3", "n2"}
	for i, g := range got {
		if g.ID != wantOrder[i] {
			t.Fatalf("append idx=%d id=%s want %s", i, g.ID, wantOrder[i])
		}
	}

	// 跨层级引用应被拒绝（MaxDepth=1 正常不会出现，属数据防护）
	s.data["child"] = &Group{ID: "child", Name: "child", ParentID: "n1", Hosts: []string{}}
	if err := s.ReorderGroups("", []string{"n1", "child"}); err == nil {
		t.Fatal("expected error when group belongs to another parent")
	}
	if err := s.ReorderGroups("n1", []string{"child"}); err != nil {
		t.Fatalf("reorder under own parent: %v", err)
	}
	delete(s.data, "child")

	// 不存在的分组应报错
	if err := s.ReorderGroups("", []string{"nope"}); err == nil {
		t.Fatal("expected error for unknown group")
	}
}

func TestReorderHosts(t *testing.T) {
	s := &Store{path: filepath.Join(t.TempDir(), "g.json"), data: map[string]*Group{}}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(s.Upsert(Group{ID: "g", Name: "g", Hosts: []string{"a", "b", "c", "d"}}))

	must(s.ReorderHosts("g", []string{"c", "a", "d", "b"}))
	got := s.data["g"].Hosts
	want := []string{"c", "a", "d", "b"}
	if len(got) != len(want) {
		t.Fatalf("hosts=%v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("idx=%d got=%s want=%s", i, got[i], want[i])
		}
	}

	// 没写全的主机按当前相对顺序补到末尾；组外名字忽略
	must(s.ReorderHosts("g", []string{"b", "nope", "a", "b"}))
	got = s.data["g"].Hosts
	want = []string{"b", "a", "c", "d"}
	if len(got) != len(want) {
		t.Fatalf("append hosts=%v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("append idx=%d got=%s want=%s", i, got[i], want[i])
		}
	}

	if err := s.ReorderHosts("missing", []string{"a"}); err == nil {
		t.Fatal("expected error for unknown group")
	}
}
