package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
)

type appLogTestFS struct {
	root   string
	opened []string
}

func (fs *appLogTestFS) Open(name string) (appLogFile, error) {
	fs.opened = append(fs.opened, name)
	return os.Open(filepath.Join(fs.root, name))
}

func (fs *appLogTestFS) ReadLink(name string) (string, error) {
	return os.Readlink(filepath.Join(fs.root, name))
}

func (fs *appLogTestFS) Stat(name string) (os.FileInfo, error) {
	return os.Stat(filepath.Join(fs.root, name))
}

func (fs *appLogTestFS) write(t *testing.T, name, content string) {
	t.Helper()
	full := filepath.Join(fs.root, name)
	if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func appLogFixture(t *testing.T) (*appLogTestFS, AppLogRequest) {
	t.Helper()
	fs := &appLogTestFS{root: t.TempDir()}
	for _, pid := range []int{101, 102} {
		parent := pid + 100
		port := pid + 8200
		screen := fmt.Sprintf("std-%d", port)
		stat := func(pid, ppid int) string {
			// Linux stat fields 3..22: state, ppid, ..., starttime.
			fields := append([]string{"S", strconv.Itoa(ppid)}, strings.Fields(strings.Repeat("0 ", 17))...)
			return fmt.Sprintf("%d (java (worker)) %s %d", pid, strings.Join(fields, " "), pid*10)
		}
		fs.write(t, fmt.Sprintf("/proc/%d/stat", pid), stat(pid, parent))
		fs.write(t, fmt.Sprintf("/proc/%d/cmdline", pid), strings.Join([]string{"java", "-jar", "/deploy/app.jar", "--server.port=" + strconv.Itoa(port)}, "\x00"))
		fs.write(t, fmt.Sprintf("/proc/%d/cmdline", parent), strings.Join([]string{"SCREEN", "-L", "-Logfile", "/deploy/logs/" + screen + ".log", "-dmS", screen, "sh", "-c", "exec java ..."}, "\x00"))
		fs.write(t, fmt.Sprintf("/proc/%d/stat", parent), stat(parent, 1))
		fs.write(t, "/deploy/logs/"+screen+".log", fmt.Sprintf("first\r\nPID %d only\r\nlast\r\n", pid))
	}
	fs.write(t, "/deploy/std-logs/application.log", "mixed PID 101 + 102; do not read")
	return fs, AppLogRequest{PID: 101, JarPath: "/deploy/app.jar", Port: 8301, Screen: "std-8301", Lines: 2}
}

func TestAppLogInstanceIsolation(t *testing.T) {
	fs, req := appLogFixture(t)
	for _, pid := range []int{101, 102} {
		req.PID, req.Port = pid, pid+8200
		req.Screen = fmt.Sprintf("std-%d", req.Port)
		got, err := readAppLog(fs, req)
		if err != nil {
			t.Fatal(err)
		}
		if got.Content != fmt.Sprintf("PID %d only\nlast", pid) || got.Source != "/deploy/logs/"+req.Screen+".log" || !got.Truncated {
			t.Fatalf("wrong instance result: %+v", got)
		}
		if got.ProcessStart != strconv.Itoa(pid*10) {
			t.Fatalf("wrong identity: %+v", got)
		}
	}
	for _, opened := range fs.opened {
		if strings.Contains(opened, "application.log") {
			t.Fatalf("read shared log: %s", opened)
		}
	}
}

func TestAppLogRejectsStaleAndMissingProcesses(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*AppLogRequest)
	}{
		{"invalid pid", func(r *AppLogRequest) { r.PID = 0 }},
		{"exited", func(r *AppLogRequest) { r.PID = 999 }},
		{"pid reused", func(r *AppLogRequest) { r.ProcessStart = "old" }},
		{"wrong jar", func(r *AppLogRequest) { r.JarPath = "/other.jar" }},
		{"wrong port", func(r *AppLogRequest) { r.Port = 8302 }},
		{"wrong session", func(r *AppLogRequest) { r.Screen = "std-8302" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fs, req := appLogFixture(t)
			tc.change(&req)
			if _, err := readAppLog(fs, req); err == nil {
				t.Fatal("expected failure")
			}
			for _, name := range fs.opened {
				if strings.HasSuffix(name, ".log") {
					t.Fatalf("read log despite invalid instance: %s", name)
				}
			}
		})
	}
}

func TestAppLogRelativeScreenPath(t *testing.T) {
	fs, req := appLogFixture(t)
	// Relative Logfile and shell metacharacters are literal paths; no shell expansion.
	name := "logs/std's $(literal).log"
	fs.write(t, "/proc/201/cmdline", strings.Join([]string{"/usr/bin/screen", "-L", "-Logfile", name, "-S", "std-8301", "java"}, "\x00"))
	if err := os.Symlink("/deploy", filepath.Join(fs.root, "/proc/201/cwd")); err != nil {
		t.Fatal(err)
	}
	fs.write(t, "/deploy/"+name, "relative log")
	got, err := readAppLog(fs, req)
	if err != nil || got.Source != "/deploy/"+name || got.Content != "relative log" {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestAppLogNoSharedFallback(t *testing.T) {
	fs, req := appLogFixture(t)
	fs.write(t, "/proc/201/cmdline", "systemd\x00")
	if _, err := readAppLog(fs, req); err == nil || !strings.Contains(err.Error(), "未找到") {
		t.Fatalf("expected no instance log, got %v", err)
	}
	for _, name := range fs.opened {
		if strings.HasSuffix(name, ".log") {
			t.Fatalf("must not read shared log: %s", name)
		}
	}
}

func TestAppLogTailLimitsAndEmpty(t *testing.T) {
	fs, _ := appLogFixture(t)
	fs.write(t, "/huge.log", strings.Repeat("历史日志内容\n", 60000)+"newest\n")
	got, truncated, err := appLogTail(fs, "/huge.log", 5000)
	if err != nil || !truncated || !strings.HasSuffix(got, "newest") || len(got) > appLogMaxBytes || len(strings.Split(got, "\n")) != 5000 {
		t.Fatalf("bad bounded tail: bytes=%d truncated=%v err=%v", len(got), truncated, err)
	}
	fs.write(t, "/empty.log", "")
	got, truncated, err = appLogTail(fs, "/empty.log", 0)
	if err != nil || truncated || got != "" {
		t.Fatalf("bad empty result: %q %v %v", got, truncated, err)
	}
	if _, _, err := appLogTail(fs, "/deploy/logs", 10); err == nil {
		t.Fatal("directory accepted")
	}
}

// Opt-in read-only SFTP integration check. Requests are explicit JSON AppLogRequest[].
// It never installs an agent, runs a remote shell, writes a remote file, or accesses a DB.
func TestAppLogLiveReadOnly(t *testing.T) {
	host, requests := os.Getenv("ONEPANEL_APP_LOG_LIVE_HOST"), os.Getenv("ONEPANEL_APP_LOG_LIVE_REQUESTS")
	if host == "" || requests == "" {
		t.Skip("set explicit host and request JSON for read-only SFTP check")
	}
	var reqs []AppLogRequest
	if err := json.Unmarshal([]byte(requests), &reqs); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-s", "--", host, "sftp")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Wait()
	sc, err := sftp.NewClientPipe(stdout, stdin)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	defer sc.Close()
	var results []AppLogResult
	for _, req := range reqs {
		got, err := readAppLog(appLogSFTP{sc}, req)
		if err != nil {
			t.Fatal(err)
		}
		if got.Source == "" || got.ProcessStart == "" {
			t.Fatalf("missing identity/source: %+v", got)
		}
		t.Logf("PID=%d source=%s bytes=%d", got.PID, got.Source, len(got.Content))
		req.ProcessStart = got.ProcessStart
		if _, err := readAppLog(appLogSFTP{sc}, req); err != nil {
			t.Fatalf("refresh failed: %v", err)
		}
		results = append(results, got)
	}
	// Optional local fixture for UI verification; contains only explicitly requested log tails.
	if output := os.Getenv("ONEPANEL_APP_LOG_LOCAL_FIXTURE"); output != "" {
		data, err := json.Marshal(results)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(output, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
