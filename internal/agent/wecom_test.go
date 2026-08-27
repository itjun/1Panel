package agent

import (
	"strings"
	"testing"
	"time"
)

func TestFormatWatchMarkdownDown(t *testing.T) {
	at := time.Date(2026, 8, 26, 16, 8, 0, 0, time.Local)
	md := formatWatchMarkdown(WatchNotify{
		Level:       "critical",
		Category:    "process",
		Host:        "cdcp-beta",
		Service:     "sapi-agent",
		Runtime:     "java",
		Port:        39665,
		Kind:        "down",
		TitleSuffix: "本机探活挂了",
		Detail:      "sapi-agent 本机探活：无进程",
		NotifyAt:    at,
	})
	want := "### <font color=\"red\">[严重]</font> cdcp-beta 的 sapi-agent · 本机探活挂了\n" +
		">时间: 2026-08-26 16:08:00\n" +
		">内容: sapi-agent 本机探活：无进程\n"
	if md != want {
		t.Fatalf("got:\n%q\nwant:\n%q", md, want)
	}
	for _, banned := range []string{">分类:", ">主机:", ">服务:", ">运行时:", ">端口:", ">入口:", ">说明:", ">通知时间:"} {
		if strings.Contains(md, banned) {
			t.Fatalf("不应包含 %q:\n%s", banned, md)
		}
	}
}

func TestFormatWatchMarkdownWarningOrange(t *testing.T) {
	md := formatWatchMarkdown(WatchNotify{
		Level:       "warning",
		Category:    "gc",
		Host:        "cdcp-beta",
		Service:     "oss",
		TitleSuffix: "GC 尖峰",
		Detail:      "oss GC pause 样例",
		NotifyAt:    time.Date(2026, 1, 2, 3, 4, 5, 0, time.Local),
	})
	if !strings.Contains(md, `### <font color="warning">[警告]</font> cdcp-beta 的 oss · GC 尖峰`) {
		t.Fatalf("%s", md)
	}
	if !strings.Contains(md, ">内容: oss GC pause 样例") {
		t.Fatalf("%s", md)
	}
}

func TestFormatWatchMarkdownUp(t *testing.T) {
	md := formatWatchMarkdown(WatchNotify{
		Level:       "ok",
		Category:    "health",
		Host:        "cdcp-beta",
		Service:     "im",
		Kind:        "up",
		TitleSuffix: "本机探活恢复",
		Detail:      "im 本机探活已恢复",
		NotifyAt:    time.Date(2026, 1, 2, 3, 4, 5, 0, time.Local),
	})
	wantPrefix := `### <font color="info">[正常]</font> cdcp-beta 的 im · 本机探活恢复`
	if !strings.HasPrefix(md, wantPrefix) {
		t.Fatalf("%s", md)
	}
	if !strings.Contains(md, ">时间: 2026-01-02 03:04:05") || !strings.Contains(md, ">内容: im 本机探活已恢复") {
		t.Fatalf("%s", md)
	}
}

func TestFormatWatchMarkdownHostDown(t *testing.T) {
	at := time.Date(2026, 8, 27, 8, 51, 0, 0, time.Local)
	md := FormatWatchMarkdown(WatchNotify{
		Level:       "critical",
		Host:        "cdcp-beta",
		Kind:        "down",
		TitleSuffix: "主机连接失败",
		Detail:      `连接 198.51.100.10:22 失败: ssh: handshake failed: EOF`,
		NotifyAt:    at,
	})
	want := "### <font color=\"red\">[严重]</font> cdcp-beta · 主机连接失败\n" +
		">时间: 2026-08-27 08:51:00\n" +
		">内容: 连接 198.51.100.10:22 失败: ssh: handshake failed: EOF\n"
	if md != want {
		t.Fatalf("got:\n%q\nwant:\n%q", md, want)
	}
}

func TestEntryFromCmdline(t *testing.T) {
	got := entryFromCmdline("java -jar /root/workspace/diteng-oss-202409.01.jar --server.port=1")
	if got != "diteng-oss-202409.01.jar" {
		t.Fatal(got)
	}
	got2 := entryFromCmdline("bun run /root/ai-agent/src/server.ts")
	if got2 != "server.ts" {
		t.Fatal(got2)
	}
}
