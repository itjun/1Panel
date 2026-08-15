package monitor

import "testing"

func TestScriptFromArgs(t *testing.T) {
	cases := []struct {
		name    string
		runtime string
		args    string
		want    string
	}{
		{"node 常规", "node", `node /opt/app/server.js --port 3000`, "/opt/app/server.js"},
		{"node 带选项", "node", `node --inspect dist/index.js`, "dist/index.js"},
		{"bun 直跑脚本", "bun", `bun server.ts`, "server.ts"},
		{"bun run 子命令", "bun", `bun run --watch server.ts`, "server.ts"},
		{"bun dev 子命令", "bun", `bun dev index.ts`, "index.ts"},
		{"python 脚本", "python", `python3 /opt/app/main.py -c cfg.toml`, "/opt/app/main.py"},
		{"python -m 模块", "python", `python3 -m http.server 8080`, "http.server"},
		{"只有解释器", "node", `node -e console.log(1)`, "console.log(1)"},
		{"无参数", "node", `node`, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := scriptFromArgs(c.runtime, c.args)
			if got != c.want {
				t.Fatalf("scriptFromArgs(%q, %q) = %q，期望 %q", c.runtime, c.args, got, c.want)
			}
		})
	}
}

func TestParseRuntimePs(t *testing.T) {
	// 字段顺序：pid user pcpu pmem rss etime comm args...
	in := "1234 root 2.5 1.2 204800 1-02:03:04 node /opt/app/server.js --port 3000\nbadline\n"
	list := parseRuntimePs(in)
	if len(list) != 1 {
		t.Fatalf("应解析出 1 条，实际 %d", len(list))
	}
	p := list[0]
	if p.PID != 1234 || p.User != "root" || p.CPU != 2.5 || p.Mem != 1.2 {
		t.Fatalf("基础字段解析错误: %+v", p)
	}
	if p.RSS != 204800*1024 {
		t.Fatalf("RSS 应为 %d，实际 %d", 204800*1024, p.RSS)
	}
	if p.Elapsed != 86400+2*3600+3*60+4 {
		t.Fatalf("Elapsed 应为 %d，实际 %d", 86400+2*3600+3*60+4, p.Elapsed)
	}
	if p.Args != "/opt/app/server.js --port 3000" {
		t.Fatalf("Args 解析错误: %q", p.Args)
	}
}
