package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDeployVerFromPath(t *testing.T) {
	if got := deployVerFromPath("/root/workspace/260828_3/diteng-std.jar"); got != "260828_3" {
		t.Fatalf("got %q", got)
	}
	if deployVerFromPath("") != "" {
		t.Fatal("empty path")
	}
}

func TestScreenNameFromCmdline(t *testing.T) {
	cmd := "SCREEN -L -Logfile /root/logs/std.log -dmS std-8301 sh -c exec java -jar app.jar"
	if got := screenNameFromCmdline(cmd); got != "std-8301" {
		t.Fatalf("got %q", got)
	}
	if got := screenNameFromCmdline("screen -S foo bash"); got != "foo" {
		t.Fatalf("-S got %q", got)
	}
}

func TestReadPPID(t *testing.T) {
	root := t.TempDir()
	// /proc/pid/stat: pid (comm) state ppid ...
	mustWrite := func(rel, body string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("10/stat", "10 (java) S 20 10 10 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 0 0 0\n")
	if got := readPPID(root, 10); got != 20 {
		t.Fatalf("ppid=%d want 20", got)
	}
}

func TestScreenFromProc(t *testing.T) {
	root := t.TempDir()
	mustWrite := func(rel, body string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// java(100) → sh(90) → screen(80)
	mustWrite("100/stat", "100 (java) S 90 100 100 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 0 0 0\n")
	mustWrite("90/stat", "90 (sh) S 80 90 90 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 0 0 0\n")
	mustWrite("90/comm", "sh\n")
	mustWrite("80/stat", "80 (screen) S 1 80 80 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 0 0 0\n")
	mustWrite("80/comm", "screen\n")
	mustWrite("80/cmdline", "SCREEN\x00-L\x00-dmS\x00std-8301\x00sh\x00-c\x00exec java\x00")
	if got := screenFromProc(root, 100); got != "std-8301" {
		t.Fatalf("screen=%q", got)
	}
}

func TestParseActuatorStartTime(t *testing.T) {
	body := []byte(`{"系统启动时间":"2026-08-28 17:47:02","项目信息":{"industry":"std"}}`)
	if got := parseActuatorStartTime(body); got != "2026-08-28 17:47:02" {
		t.Fatalf("got %q", got)
	}
}

func TestGroupForService(t *testing.T) {
	if groupForService("std") != "std" {
		t.Fatal("std")
	}
	if groupForService("fpl") != "pro" {
		t.Fatal("fpl")
	}
	if groupForService("ai-agent") != "other" {
		t.Fatal("ai-agent")
	}
	if groupForService("sapi-agent") != "other" {
		t.Fatal("sapi-agent")
	}
}

func TestInstanceStatus(t *testing.T) {
	if instanceStatus(false, false) != "DOWN" {
		t.Fatal("down")
	}
	if instanceStatus(true, true) != "UP" {
		t.Fatal("up")
	}
	if instanceStatus(true, false) != "UNHEALTHY" {
		t.Fatal("unhealthy")
	}
}

func TestJarFromCmdline(t *testing.T) {
	cmd := "java -Xmx2g -jar /root/workspace/260828_3/diteng-std.jar --server.port=8301"
	if got := jarFromCmdline(cmd); got != "/root/workspace/260828_3/diteng-std.jar" {
		t.Fatalf("got %q", got)
	}
}
