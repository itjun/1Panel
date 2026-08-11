package sshconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestUpdateHostFieldsFile(t *testing.T) {
	path := writeTempConfig(t, `
Host demo
    HostName 1.2.3.4
    User root
    IdentityFile ~/.ssh/id_ed25519
`)
	if err := UpdateHostFieldsFile(path, "demo", "10.0.0.1", "ubuntu"); err != nil {
		t.Fatal(err)
	}
	got := readFile(t, path)
	if !strings.Contains(got, "HostName 10.0.0.1") {
		t.Fatalf("HostName not updated:\n%s", got)
	}
	if !strings.Contains(got, "User ubuntu") {
		t.Fatalf("User not updated:\n%s", got)
	}
	if !strings.Contains(got, "IdentityFile") {
		t.Fatalf("IdentityFile should remain:\n%s", got)
	}
}

func TestUpdateHostFieldsFile_InsertMissing(t *testing.T) {
	path := writeTempConfig(t, "Host bare\n")
	if err := UpdateHostFieldsFile(path, "bare", "192.168.1.1", "admin"); err != nil {
		t.Fatal(err)
	}
	got := readFile(t, path)
	if !strings.Contains(got, "HostName 192.168.1.1") || !strings.Contains(got, "User admin") {
		t.Fatalf("expected inserted fields:\n%s", got)
	}
}

func TestDeleteHostFile_Single(t *testing.T) {
	path := writeTempConfig(t, `
# keep me
Host keep
    HostName 1.1.1.1

# === 由 ServerPanel 添加 于 2026-01-01 00:00:00 ===
Host drop-me
    HostName 2.2.2.2
    User root

Host after
    HostName 3.3.3.3
`)
	if err := DeleteHostFile(path, "drop-me"); err != nil {
		t.Fatal(err)
	}
	got := readFile(t, path)
	if strings.Contains(got, "drop-me") || strings.Contains(got, "2.2.2.2") {
		t.Fatalf("host not deleted:\n%s", got)
	}
	if !strings.Contains(got, "Host keep") || !strings.Contains(got, "Host after") {
		t.Fatalf("other hosts damaged:\n%s", got)
	}
	if strings.Contains(got, "由 ServerPanel 添加") {
		t.Fatalf("marker comment should be removed:\n%s", got)
	}
}

func TestDeleteHostFile_MultiAlias(t *testing.T) {
	path := writeTempConfig(t, "Host a b c\n    HostName 9.9.9.9\n")
	if err := DeleteHostFile(path, "b"); err != nil {
		t.Fatal(err)
	}
	got := readFile(t, path)
	if strings.Contains(got, " b ") || strings.HasSuffix(strings.TrimSpace(got), "b") {
		// more reliable check
	}
	if !strings.Contains(got, "Host a c") {
		t.Fatalf("expected remaining aliases:\n%s", got)
	}
	if !strings.Contains(got, "9.9.9.9") {
		t.Fatalf("shared fields should remain:\n%s", got)
	}
}

func TestDeleteHostFile_NotFound(t *testing.T) {
	path := writeTempConfig(t, "Host x\n")
	err := DeleteHostFile(path, "missing")
	if err == nil {
		t.Fatal("expected error")
	}
}
