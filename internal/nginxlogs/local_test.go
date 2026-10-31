package nginxlogs

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func requireZstd(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("zstd"); err != nil {
		t.Skip("zstd is required")
	}
}
func readArchive(t *testing.T, path string) map[string]string {
	t.Helper()
	raw, err := exec.Command("zstd", "-d", "-q", "-c", path).Output()
	if err != nil {
		t.Fatal(err)
	}
	reader := tar.NewReader(bytes.NewReader(raw))
	out := map[string]string{}
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		out[header.Name] = string(data)
	}
	return out
}

func TestLocalExportSelectionAndFixedLength(t *testing.T) {
	requireZstd(t)
	root := t.TempDir()
	tmp := t.TempDir()
	dest := filepath.Join(t.TempDir(), "logs.tar.zst")
	for _, name := range []string{"access.log", "error.log", "access.log.1", "access.log.2", "access.log.gz", "other.log"} {
		os.WriteFile(filepath.Join(root, name), []byte(name+"\n"), 0600)
	}
	old := time.Now().AddDate(0, 0, -1)
	os.Chtimes(filepath.Join(root, "access.log.2"), old, old)
	os.Symlink(filepath.Join(root, "access.log"), filepath.Join(root, "error.log.1"))
	var isAppended bool
	err := ExportLocal(context.Background(), root, tmp, dest, func(p Progress) {
		if p.Phase == "checked" && !isAppended {
			isAppended = true
			file, _ := os.OpenFile(filepath.Join(root, "access.log"), os.O_APPEND|os.O_WRONLY, 0600)
			file.WriteString("later\n")
			file.Close()
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	files := readArchive(t, dest)
	if len(files) != 3 || files["access.log"] != "access.log\n" || files["error.log"] != "error.log\n" || files["access.log.1"] != "access.log.1\n" {
		t.Fatalf("archive=%v", files)
	}
	entries, _ := os.ReadDir(tmp)
	if len(entries) != 0 {
		t.Fatalf("temporary files: %v", entries)
	}
	raw, _ := os.ReadFile(filepath.Join(root, "access.log"))
	if string(raw) != "access.log\nlater\n" {
		t.Fatal("source changed")
	}
}

func TestLocalExportFailurePreservesDestination(t *testing.T) {
	requireZstd(t)
	for _, mode := range []string{"cancel", "truncate", "concurrent"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			tmp := t.TempDir()
			out := t.TempDir()
			dest := filepath.Join(out, "logs.tar.zst")
			os.WriteFile(dest, []byte("keep"), 0600)
			path := filepath.Join(root, "access.log")
			os.WriteFile(path, []byte(strings.Repeat("log\n", 100000)), 0600)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var isTriggered bool
			err := ExportLocal(ctx, root, tmp, dest, func(p Progress) {
				if p.Phase == "checked" && !isTriggered {
					isTriggered = true
					switch mode {
					case "cancel":
						cancel()
					case "truncate":
						os.Truncate(path, 0)
					case "concurrent":
						if nested := ExportLocal(ctx, root, tmp, dest, nil); nested == nil {
							t.Error("concurrent export accepted")
						}
						cancel()
					}
				}
			})
			if err == nil {
				t.Fatal("expected failure")
			}
			raw, _ := os.ReadFile(dest)
			if string(raw) != "keep" {
				t.Fatal("destination overwritten")
			}
			entries, _ := os.ReadDir(tmp)
			if len(entries) != 0 {
				t.Fatal("temporary archive leaked")
			}
			entries, _ = os.ReadDir(out)
			if len(entries) != 1 {
				t.Fatal("part file leaked")
			}
		})
	}
}

func TestLocalExportProtectsSourceLogs(t *testing.T) {
	requireZstd(t)
	root := t.TempDir()
	for _, name := range []string{"access.log", "error.log.1"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().AddDate(0, 0, -1)
	os.Chtimes(filepath.Join(root, "error.log.1"), old, old)
	for _, name := range []string{"access.log", "error.log.1"} {
		path := filepath.Join(root, name)
		if err := ExportLocal(context.Background(), root, t.TempDir(), path, nil); err == nil {
			t.Fatalf("source accepted as destination: %s", name)
		}
		raw, err := os.ReadFile(path)
		if err != nil || string(raw) != "original" {
			t.Fatalf("source changed: %s %v", name, err)
		}
	}
}

func TestLocalExportRejectsMissingDependencyAndDiskBudget(t *testing.T) {
	if err := checkLocalSpace(t.TempDir(), ^uint64(0)); err == nil {
		t.Fatal("impossible space budget accepted")
	}
	t.Setenv("PATH", t.TempDir())
	if _, err := findZstd([]string{filepath.Join(t.TempDir(), "zstd")}); err == nil || !strings.Contains(err.Error(), "zstd") {
		t.Fatalf("missing dependency: %v", err)
	}
}

func TestZstdFallbackWithoutShellPath(t *testing.T) {
	bin, err := exec.LookPath("zstd")
	if err != nil {
		t.Skip("zstd is required")
	}
	t.Setenv("PATH", t.TempDir())
	got, err := findZstd([]string{bin})
	if err != nil || got != bin {
		t.Fatalf("fallback: %q %v", got, err)
	}
}

func TestLocalLogFilesDateBoundary(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.FixedZone("test", 8*3600))
	start := time.Date(2026, 10, 31, 0, 0, 0, 0, now.Location())
	for name, stamp := range map[string]time.Time{"access.log": start, "error.log": start.AddDate(0, 0, 1), "access.log.1": start.Add(-time.Second)} {
		path := filepath.Join(root, name)
		os.WriteFile(path, nil, 0600)
		os.Chtimes(path, stamp, stamp)
	}
	files, skipped, err := localLogFiles(root, now)
	if err != nil || len(files) != 1 || skipped != 2 || files[0].info.Name() != "access.log" {
		t.Fatalf("selection: %v %d %v", files, skipped, err)
	}
}
