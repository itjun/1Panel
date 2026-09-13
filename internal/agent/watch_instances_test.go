package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeployVerFromPath(t *testing.T) {
	if got := deployVerFromPath("/root/workspace/260828_3/diteng-std.jar"); got != "260828_3" {
		t.Fatalf("old layout got %q", got)
	}
	if got := deployVerFromPath("/root/workspace/rc/20260908_6/diteng-im-server-202409.01.jar"); got != "20260908_6" {
		t.Fatalf("new layout got %q want 20260908_6", got)
	}
	if got := deployVerFromPath("/root/workspace/oss/20260908_1/diteng-oss-202409.01.jar"); got != "20260908_1" {
		t.Fatalf("oss got %q", got)
	}
	if deployVerFromPath("") != "" {
		t.Fatal("empty path")
	}
}

func TestServiceDeployDir(t *testing.T) {
	if got := serviceDeployDir("/root/workspace/oss/20260908_1/diteng-oss.jar"); got != "/root/workspace/oss" {
		t.Fatalf("new got %q", got)
	}
	if got := serviceDeployDir("/root/workspace/260903_1/diteng-oss.jar"); got != "/root/workspace" {
		t.Fatalf("old got %q", got)
	}
	if serviceDeployDir("/tmp/plain.jar") != "" {
		t.Fatal("no ver")
	}
}

func TestLatestDeployVerInDir(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"20260907_1", "20260908_1", "20260908_2", "logs", "diteng-oss.jar"} {
		p := filepath.Join(root, name)
		if strings.HasSuffix(name, ".jar") {
			if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if err := os.Mkdir(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if got := latestDeployVerInDir(root); got != "20260908_2" {
		t.Fatalf("got %q want 20260908_2", got)
	}
}

func TestCompareDeployVer(t *testing.T) {
	if compareDeployVer("20260908_1", "260903_1") <= 0 {
		t.Fatal("8-digit should beat padded 6-digit older date")
	}
	if compareDeployVer("20260908_2", "20260908_1") <= 0 {
		t.Fatal("seq")
	}
	if compareDeployVer("260903_1", "260828_3") <= 0 {
		t.Fatal("old layout date")
	}
	// 日=10：未对齐时 "260903" 字典序大于 "20260910"，必须先补成 20YYMMDD
	if compareDeployVer("20260910_1", "260903_2") <= 0 {
		t.Fatal("day-10 8-digit must beat older 6-digit")
	}
	if compareDeployVer("260910_1", "20260910_1") != 0 {
		t.Fatal("YYMMDD and YYYYMMDD same calendar day should tie")
	}
	if compareDeployVer("20260910_2", "260910_1") <= 0 {
		t.Fatal("same day higher seq")
	}
}

func TestLatestDeployVerInDirDay10(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"260903_2", "20260908_1", "20260910_1"} {
		if err := os.Mkdir(filepath.Join(root, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if got := latestDeployVerInDir(root); got != "20260910_1" {
		t.Fatalf("got %q want 20260910_1", got)
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

func TestResolveJarPath(t *testing.T) {
	root := t.TempDir()
	cwd := filepath.Join(root, "workspace", "oss", "20260908_1")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatal(err)
	}
	procDir := filepath.Join(root, "proc", "42")
	if err := os.MkdirAll(procDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(cwd, filepath.Join(procDir, "cwd")); err != nil {
		t.Fatal(err)
	}
	procRoot := filepath.Join(root, "proc")

	abs := "/root/workspace/oss/20260908_1/diteng-oss.jar"
	if got := resolveJarPath(procRoot, 42, abs); got != filepath.Clean(abs) {
		t.Fatalf("abs got %q", got)
	}
	want := filepath.Join(cwd, "diteng-oss-202409.01.jar")
	if got := resolveJarPath(procRoot, 42, "diteng-oss-202409.01.jar"); got != want {
		t.Fatalf("rel got %q want %q", got, want)
	}
	if got := deployVerFromPath(want); got != "20260908_1" {
		t.Fatalf("deployVer %q", got)
	}
	if got := resolveJarPath(procRoot, 99, "app.jar"); got != "app.jar" {
		t.Fatalf("missing cwd should keep relative, got %q", got)
	}
}
