package localsys

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestNginxLogPaths(t *testing.T) {
	if runtime.GOOS == "windows" {
		for _, raw := range []string{"", `--prefix="C:/Program Files/nginx" --http-log-path=logs/access.log --error-log-path=logs/error.log`} {
			a, e := nginxLogPaths(raw, `C:\Program Files\nginx\nginx.exe`, `C:\Program Files\nginx\conf\nginx.conf`, "windows")
			if a != filepath.Clean(`C:\Program Files\nginx\logs\access.log`) || e != filepath.Clean(`C:\Program Files\nginx\logs\error.log`) {
				t.Fatalf("Windows paths = %q %q", a, e)
			}
		}
		return
	}
	cases := []struct{ name, raw, bin, conf, platform, access, failure string }{
		{"homebrew", "", "/opt/homebrew/bin/nginx", "/opt/homebrew/etc/nginx/nginx.conf", "darwin", "/opt/homebrew/var/log/nginx/access.log", "/opt/homebrew/var/log/nginx/error.log"},
		{"linux", "--prefix=/srv/nginx --http-log-path=logs/access.log --error-log-path=/var/custom/error.log", "/usr/sbin/nginx", "/etc/nginx/nginx.conf", "linux", "/srv/nginx/logs/access.log", "/var/custom/error.log"},
		{"spaces", `--prefix='/srv/my nginx' '--http-log-path=logs/access.log' --error-log-path="logs/error.log"`, "/usr/bin/nginx", "/etc/nginx/nginx.conf", "linux", "/srv/my nginx/logs/access.log", "/srv/my nginx/logs/error.log"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			a, e := nginxLogPaths(tt.raw, tt.bin, tt.conf, tt.platform)
			if filepath.ToSlash(a) != tt.access || filepath.ToSlash(e) != tt.failure {
				t.Fatalf("paths = %q %q", a, e)
			}
		})
	}
}

func TestReadLogTail(t *testing.T) {
	path := filepath.Join(t.TempDir(), "access.log")
	for _, tt := range []struct {
		raw   string
		lines int
		want  string
	}{
		{"", 500, ""}, {"one\ntwo\nthree\n", 2, "two\nthree"}, {"one\ntwo\nthree", 2, "two\nthree"}, {"one\ntwo\n", 500, "one\ntwo"}, {"one\n\n", 1, ""},
		{strings.Repeat("discarded line\n", 1000000) + "last\n", 1, "last"},
	} {
		if err := os.WriteFile(path, []byte(tt.raw), 0600); err != nil {
			t.Fatal(err)
		}
		got, err := readLogTail(context.Background(), path, tt.lines)
		if err != nil || got != tt.want {
			t.Fatalf("tail: %q %v", got, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := readLogTail(ctx, path, 1); err == nil {
		t.Fatal("expected cancellation")
	}
	if _, err := readLogTail(context.Background(), path+".missing", 1); !os.IsNotExist(err) {
		t.Fatalf("missing error: %v", err)
	}
	if _, err := readLogTail(context.Background(), filepath.Dir(path), 1); err == nil {
		t.Fatal("expected regular-file check")
	}
	if runtime.GOOS != "windows" && os.Geteuid() != 0 {
		os.Chmod(path, 0000)
		defer os.Chmod(path, 0600)
		if _, err := readLogTail(context.Background(), path, 1); !os.IsPermission(err) {
			t.Fatalf("permission: %v", err)
		}
	}
}

func TestReadLogTailBound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "access.log")
	os.WriteFile(path, []byte(strings.Repeat("x", 9<<20)), 0600)
	if _, err := readLogTail(context.Background(), path, 100); err == nil {
		t.Fatal("unbounded line accepted")
	}
}

func TestHostsReportsRealPath(t *testing.T) {
	info, err := CollectHosts()
	if err != nil {
		t.Skip(err)
	}
	if info.Path != hostsFilePath() {
		t.Fatalf("path=%q", info.Path)
	}
}
