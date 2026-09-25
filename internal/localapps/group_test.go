package localapps

import (
	"testing"
)

func TestDetectRuntime(t *testing.T) {
	cases := []struct {
		comm string
		args []string
		exe  string
		isGo bool
		want string
	}{
		{"java", []string{"java", "-jar", "app.jar"}, "", false, "java"},
		{"node", []string{"node", "server.js"}, "", false, "javascript"},
		{"node", []string{"node", "/usr/local/lib/node_modules/npm/bin/npm-cli.js", "run", "dev"}, "", false, "javascript"},
		{"node", []string{"node", "/x/npx-cli.js", "foo"}, "", false, "javascript"},
		{"bun", []string{"bun", "run", "index.ts"}, "", false, "javascript"},
		{"deno", []string{"deno", "run", "app.ts"}, "", false, "javascript"},
		{"myapp", []string{"./myapp"}, "", true, "go"},
		{"bash", []string{"bash"}, "", false, ""},
		{"python3.11", []string{"python3.11", "app.py"}, "", false, "python"},
		{"python", []string{"python", "-m", "http.server"}, "/usr/bin/python3", false, "python"},
		{"dotnet", []string{"dotnet", "run"}, "", false, "csharp"},
		{"swift", []string{"swift", "run"}, "", false, "swift"},
		{"clang", []string{"clang", "-fobjc-arc", "a.m"}, "", false, "objc"},
		{"clang++", []string{"clang++", "a.cpp"}, "", false, "ccpp"},
		{"gcc", []string{"gcc", "a.c"}, "", false, "ccpp"},
		{"rustc", []string{"rustc", "main.rs"}, "", false, "rust"},
		{"ruby", []string{"ruby", "app.rb"}, "", false, "ruby"},
		{"php", []string{"php", "index.php"}, "", false, "php"},
		// Node 改写进程名后仍靠 exe 识别
		{"next-server (v16.3.4)", []string{"next-server (v16.3.4)"}, "/fnm/versions/node/bin/node", false, "javascript"},
		{"Raycast Beta Backend", []string{"Raycast"}, "/usr/local/bin/node", false, "javascript"},
	}
	for _, c := range cases {
		got := DetectRuntime(c.comm, c.args, c.exe, c.isGo)
		if got != c.want {
			t.Fatalf("DetectRuntime(%q, %v, %q, %v) = %q, want %q", c.comm, c.args, c.exe, c.isGo, got, c.want)
		}
	}
}

func TestJsEngine(t *testing.T) {
	if got := jsEngine("bun", "/bin/bun", []string{"bun", "run", "x.ts"}); got != "bun" {
		t.Fatalf("bun engine=%s", got)
	}
	if got := jsEngine("node", "/bin/node", []string{"node", "/lib/npm-cli.js", "run", "dev"}); got != "npm" {
		t.Fatalf("npm engine=%s", got)
	}
	if got := jsEngine("node", "/bin/node", []string{"node", "a.js"}); got != "node" {
		t.Fatalf("node engine=%s", got)
	}
}

func TestGroupApps_NodeRenamedChildKeepsPorts(t *testing.T) {
	procs := []RawProc{
		{
			PID: 64185, PPID: 1, Comm: "node", Exe: "/bin/node",
			Args: []string{"node", "cli.js"},
		},
		{
			PID: 64195, PPID: 64185, Comm: "next-server (v16.3.4)", Exe: "/bin/node",
			Args:  []string{"next-server (v16.3.4)"},
			Ports: []int{20128},
		},
	}
	apps := GroupApps(procs)
	if len(apps) != 1 {
		t.Fatalf("期望 1 个应用，得到 %d", len(apps))
	}
	if apps[0].Runtime != "javascript" {
		t.Fatalf("runtime=%s", apps[0].Runtime)
	}
	if apps[0].ProcCount != 2 {
		t.Fatalf("期望 2 个进程，得到 %d", apps[0].ProcCount)
	}
	found := false
	for _, p := range apps[0].Procs {
		for _, port := range p.Ports {
			if port == 20128 {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("未汇总到子进程端口 20128")
	}
}

func TestGroupApps_JavaJarAndSpring(t *testing.T) {
	procs := []RawProc{
		{
			PID: 101, PPID: 1, Comm: "java",
			Args: []string{"java", "-jar", "/opt/a/app.jar"},
		},
		{
			PID: 102, PPID: 1, Comm: "java",
			Args: []string{"java", "-Dspring.application.name=order-svc", "-jar", "/opt/b/app.jar"},
		},
	}
	apps := GroupApps(procs)
	if len(apps) != 2 {
		t.Fatalf("期望 2 个应用，得到 %d", len(apps))
	}
	keys := map[string]bool{}
	for _, a := range apps {
		keys[a.Key] = true
		if a.Runtime != "java" {
			t.Fatalf("runtime=%s", a.Runtime)
		}
	}
	if !keys["java:jar:/opt/a/app.jar"] {
		t.Fatalf("缺少 jar 分组: %#v", keys)
	}
	if !keys["java:spring:order-svc"] {
		t.Fatalf("缺少 spring 分组: %#v", keys)
	}
}

func TestGroupApps_ParentChildMerge(t *testing.T) {
	procs := []RawProc{
		{
			PID: 200, PPID: 1, Comm: "node", Cwd: "/app",
			Args: []string{"node", "parent.js"},
		},
		{
			PID: 201, PPID: 200, Comm: "node", Cwd: "/app",
			Args: []string{"node", "child.js"},
		},
	}
	apps := GroupApps(procs)
	if len(apps) != 1 {
		t.Fatalf("父子应归并为一个应用，得到 %d: %+v", len(apps), apps)
	}
	if apps[0].ProcCount != 2 {
		t.Fatalf("ProcCount=%d", apps[0].ProcCount)
	}
	if apps[0].Key != "js:node:script:parent.js" {
		t.Fatalf("key=%s", apps[0].Key)
	}
}

func TestGroupApps_NPMByCwdAndRun(t *testing.T) {
	procs := []RawProc{
		{
			PID: 10, PPID: 1, Comm: "node", Cwd: "/Users/me/proj",
			Args: []string{"node", "/lib/npm-cli.js", "run", "dev"},
		},
	}
	apps := GroupApps(procs)
	if len(apps) != 1 {
		t.Fatalf("len=%d", len(apps))
	}
	if apps[0].Runtime != "javascript" {
		t.Fatalf("runtime=%s", apps[0].Runtime)
	}
	if apps[0].Key != "js:npm:cwd:/Users/me/proj:run:dev" {
		t.Fatalf("key=%s", apps[0].Key)
	}
	if apps[0].Procs[0].Extra["engine"] != "npm" {
		t.Fatalf("extra.engine=%v", apps[0].Procs[0].Extra)
	}
	if apps[0].Procs[0].Extra["script"] != "dev" {
		t.Fatalf("extra.script=%v", apps[0].Procs[0].Extra)
	}
}

func TestGroupApps_GoByExe(t *testing.T) {
	procs := []RawProc{
		{
			PID: 7, PPID: 1, Comm: "myserver", Exe: "/usr/local/bin/myserver", IsGo: true,
			Args: []string{"/usr/local/bin/myserver", "-c", "cfg.yaml"},
		},
	}
	apps := GroupApps(procs)
	if len(apps) != 1 || apps[0].Runtime != "go" {
		t.Fatalf("%+v", apps)
	}
	if apps[0].Key != "go:exe:/usr/local/bin/myserver" {
		t.Fatalf("key=%s", apps[0].Key)
	}
}

func TestGroupApps_SelfName(t *testing.T) {
	procs := []RawProc{
		{
			PID: 1, PPID: 0, Comm: "node",
			Args:  []string{"node", "app.js"},
			Extra: map[string]string{"self": "1"},
		},
	}
	apps := GroupApps(procs)
	if len(apps) != 1 {
		t.Fatal(apps)
	}
	if apps[0].Name != "app.js (本程序)" {
		t.Fatalf("name=%q", apps[0].Name)
	}
	if apps[0].Runtime != "javascript" {
		t.Fatalf("runtime=%s", apps[0].Runtime)
	}
}

func TestGroupApps_ServiceCandidatesUseProcessTree(t *testing.T) {
	procs := []RawProc{
		{
			PID: 500, PPID: 1, User: "me", Exe: "/opt/tools/custom-server",
			Cwd: "/Users/me/Project One", Ports: []int{3000}, CPU: 2,
		},
		{
			PID: 501, PPID: 500, User: "me", Exe: "/opt/tools/custom-worker",
			Cwd: "/Users/me/Project One", Ports: []int{3001}, CPU: 1,
		},
		{
			PID: 502, PPID: 1, User: "me", Exe: "/opt/tools/custom-server",
			Cwd: "/Users/me/Project One", Ports: []int{3000}, CPU: 0.5,
		},
		{PID: 503, PPID: 1, User: "me", Exe: "/opt/tools/helper"},
	}

	apps := GroupApps(procs)
	if len(apps) != 2 {
		t.Fatalf("期望 2 个服务候选组，得到 %d: %+v", len(apps), apps)
	}
	if apps[0].Kind != AppKindService || apps[0].Runtime != "unknown" {
		t.Fatalf("服务候选分类错误: %+v", apps[0])
	}
	if apps[0].Confidence != ConfidenceMedium || len(apps[0].Evidence) == 0 {
		t.Fatalf("服务候选缺少置信度或发现依据: %+v", apps[0])
	}
	if apps[0].ProcCount != 2 {
		t.Fatalf("父子服务进程应归入同组，进程数=%d", apps[0].ProcCount)
	}
	if apps[1].ProcCount != 1 {
		t.Fatalf("独立启动的同名服务应保持独立，进程数=%d", apps[1].ProcCount)
	}
}
