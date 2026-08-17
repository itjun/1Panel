package monitor

import "testing"

func TestParseRuntimes(t *testing.T) {
	s := "=java=\npath=/usr/bin/java\nver=openjdk version \"17.0.2\" 2022-01-18\n=go=\npath=/usr/local/go/bin/go\nver=go version go1.21.5 linux/arm64\n=python3=\npath=/usr/bin/python3\nver=Python 3.10.12\n=python=\n=pyt=\n=node=\npath=/usr/bin/node\nver=v18.16.0\n=bun=\n"
	m := parseRuntimes(s)
	if m["java"].Version != "17.0.2" || m["java"].Path != "/usr/bin/java" {
		t.Fatalf("java 解析错误: %+v", m["java"])
	}
	if m["go"].Version != "1.21.5" {
		t.Fatalf("go 版本错误: %s", m["go"].Version)
	}
	if m["python3"].Version != "3.10.12" {
		t.Fatalf("python 版本错误: %s", m["python3"].Version)
	}
	if m["node"].Version != "18.16.0" {
		t.Fatalf("node 版本错误: %s", m["node"].Version)
	}
	if _, ok := m["bun"]; !ok {
		t.Fatal("bun 未安装时也应有条目")
	}
	if m["bun"].Path != "" {
		t.Fatalf("bun 未安装时 path 应为空: %s", m["bun"].Path)
	}
}

func TestAssembleRuntimesPythonName(t *testing.T) {
	s := "=python3=\npath=/usr/bin/python3\nver=Python 3.12.3\n=python=\npath=/usr/bin/python\nver=Python 3.12.3\n"
	list := assembleRuntimes(parseRuntimes(s))
	var py *RuntimeInfo
	for i := range list {
		if list[i].Name == "python" {
			py = &list[i]
			break
		}
		if list[i].Name == "python3" {
			t.Fatal("展示名不应保留 python3")
		}
	}
	if py == nil {
		t.Fatal("缺少 python 条目")
	}
	if py.Path != "/usr/bin/python3" || py.Version != "3.12.3" {
		t.Fatalf("应优先 python3 的路径与版本: %+v", py)
	}
}
