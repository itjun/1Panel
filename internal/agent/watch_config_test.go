package agent

import "testing"

func TestMatchServiceJarAndPort(t *testing.T) {
	s := ServiceWatch{Name: "std", JarContains: "diteng-std", PortFrom: 8301, PortTo: 8309}
	cmd := "java -Xmx2g -jar /root/workspace/x/diteng-std-202409.01.jar --server.port=8301"
	if !matchService(s, cmd, []int{8301}) {
		t.Fatal("应匹配 jar 名")
	}
	if matchService(s, "java -jar diteng-oss.jar --server.port=8011", []int{8011}) {
		t.Fatal("不应匹配 oss")
	}
	if !matchService(s, "java -jar app.jar --server.port=8302", []int{8302}) {
		t.Fatal("应按端口区间匹配")
	}
}

func TestParseDefaultWatchYAML(t *testing.T) {
	c, err := parseWatchYAML([]byte(defaultWatchYAML))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Services) != 8 {
		t.Fatalf("services=%d", len(c.Services))
	}
	names := map[string]bool{}
	for _, s := range c.Services {
		names[s.Name] = true
	}
	for _, n := range []string{"im", "ai-agent", "sapi-agent"} {
		if !names[n] {
			t.Fatalf("缺服务 %s", n)
		}
	}
	var bun, sapi ServiceWatch
	for _, s := range c.Services {
		if s.Name == "ai-agent" {
			bun = s
		}
		if s.Name == "sapi-agent" {
			sapi = s
		}
	}
	if bun.Runtime != "bun" || bun.ScrapeMetrics || bun.HealthPath != "/health" {
		t.Fatalf("ai-agent 应为 bun: %+v", bun)
	}
	if sapi.Runtime != "java" || !sapi.ScrapeMetrics || sapi.HealthPath != "/actuator/health" {
		t.Fatalf("sapi-agent 应为 java: %+v", sapi)
	}
	if c.Services[0].Name != "oss" || !c.Services[0].Ingress.Enabled {
		t.Fatalf("oss 入口层应默认开启: %+v", c.Services[0])
	}
	if c.IntervalSec != 15 || c.FailStreak != 2 {
		t.Fatalf("默认间隔/失败次数: %+v", c)
	}
}

func TestMergeMissingRavenclawServices(t *testing.T) {
	old := []byte(`wecomWebhook: "keep-me"
services:
  - name: oss
    jarContains: diteng-oss
    portFrom: 8011
    portTo: 8019
`)
	out, changed, err := mergeMissingServices(old)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	c, err := parseWatchYAML(out)
	if err != nil {
		t.Fatal(err)
	}
	if c.WecomWebhook != "keep-me" {
		t.Fatalf("webhook 被覆盖: %q", c.WecomWebhook)
	}
	have := map[string]bool{}
	for _, s := range c.Services {
		have[s.Name] = true
	}
	if !have["im"] || !have["ai-agent"] || !have["sapi-agent"] {
		t.Fatalf("未合并 ravenclaw 服务: %+v", have)
	}
}

func TestMatchWatchedRuntime(t *testing.T) {
	bun := ServiceWatch{Name: "ai-agent", Runtime: "bun", JarContains: "ai-agent", PortFrom: 3060, PortTo: 3060}
	java := ServiceWatch{Name: "sapi-agent", Runtime: "java", JarContains: "sapi-agent", PortFrom: 50000, PortTo: 50000}
	bunProc := javaProc{Comm: "bun", Cmdline: "/root/ai-agent/src/server.ts", Ports: []int{3060}}
	javaProcSapi := javaProc{Comm: "java", Cmdline: "java -jar sapi-agent-0.0.1.jar", Ports: []int{50000}}
	if !matchWatched(bun, bunProc) {
		t.Fatal("bun 应匹配 ai-agent")
	}
	if matchWatched(bun, javaProcSapi) {
		t.Fatal("bun 监视不应吃 java")
	}
	if !matchWatched(java, javaProcSapi) {
		t.Fatal("java 应匹配 sapi-agent")
	}
	if matchWatched(java, bunProc) {
		t.Fatal("java 监视不应吃 bun")
	}
}
