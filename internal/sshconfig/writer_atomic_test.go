package sshconfig

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func mustNoTmp(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".tmp") {
			t.Fatalf("leftover temp file: %s", e.Name())
		}
	}
}

func TestWriteConfigAtomic_ReplacesContentNoTmp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config")
	if err := os.WriteFile(path, []byte("old\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeConfigAtomic(path, "new content\n"); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, path); got != "new content\n" {
		t.Fatalf("got %q", got)
	}
	mustNoTmp(t, dir)
}

func TestWriteConfigAtomic_Mode0600(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix file mode")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "config")
	if err := os.WriteFile(path, []byte("old\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeConfigAtomic(path, "new\n"); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := fi.Mode().Perm(); perm != 0600 {
		t.Fatalf("mode %o, want 0600", perm)
	}
	mustNoTmp(t, dir)
}

func TestWriteConfigAtomic_ExistingFileBackup(t *testing.T) {
	old := "Host a\n    HostName 1.1.1.1\n"
	path := writeTempConfig(t, old)
	if err := writeConfigAtomic(path, "Host b\n"); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, path); got != "Host b\n" {
		t.Fatalf("dest content %q", got)
	}
	dir := filepath.Dir(path)
	matches, err := filepath.Glob(filepath.Join(dir, "config.bak.*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected 1 backup, got %v", matches)
	}
	if got := readFile(t, matches[0]); got != old {
		t.Fatalf("backup %q", got)
	}
	mustNoTmp(t, dir)
}

func TestWriteConfigAtomic_NewFileNoBackup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config")
	if err := writeConfigAtomic(path, "Host x\n"); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, path); got != "Host x\n" {
		t.Fatalf("got %q", got)
	}
	matches, err := filepath.Glob(filepath.Join(dir, "config.bak.*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("new file should not create backup, got %v", matches)
	}
	mustNoTmp(t, dir)
}

func TestRenameHostFile_RoundTrip(t *testing.T) {
	path := writeTempConfig(t, "Host oldname\n    HostName 1.2.3.4\n")
	if err := RenameHostFile(path, "oldname", "newname"); err != nil {
		t.Fatal(err)
	}
	got := readFile(t, path)
	if !strings.Contains(got, "Host newname") {
		t.Fatalf("rename forward:\n%s", got)
	}
	if strings.Contains(got, "Host oldname") {
		t.Fatalf("old alias still present:\n%s", got)
	}
	if !strings.Contains(got, "1.2.3.4") {
		t.Fatalf("HostName lost:\n%s", got)
	}
	if err := RenameHostFile(path, "newname", "oldname"); err != nil {
		t.Fatal(err)
	}
	got = readFile(t, path)
	if !strings.Contains(got, "Host oldname") || strings.Contains(got, "Host newname") {
		t.Fatalf("rename back:\n%s", got)
	}
	mustNoTmp(t, filepath.Dir(path))
}
