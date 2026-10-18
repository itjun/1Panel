package appbackup

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fixture(t *testing.T) *Snapshot {
	t.Helper()
	s := &Snapshot{Manifest: Manifest{Format: Format, Version: 1, SourceOS: runtime.GOOS, SourceHome: "/old-home", SourceDataDir: "/old-home/data", Preferences: map[string]string{"ipannel.settings.v1": `{"directory":"/old-home/work"}`}}}
	if err := s.Add("data/panel.json", []byte(`{"version":1,"hosts":[],"groups":[]}`), 0600, true); err != nil {
		t.Fatal(err)
	}
	return s
}
func put(t *testing.T, p, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestRoundTripAndRelocatePreferences(t *testing.T) {
	s := fixture(t)
	s.Add("ssh/config", []byte("IdentityFile /old-home/.ssh/id_work\n"), 0600, true)
	out := filepath.Join(t.TempDir(), "full.zip")
	if err := Write(out, s); err != nil {
		t.Fatal(err)
	}
	got, hash, err := Read(out)
	if err != nil || len(hash) != 64 {
		t.Fatalf("read: %s %v", hash, err)
	}
	home := t.TempDir()
	root := filepath.Join(home, "data")
	os.MkdirAll(root, 0700)
	if err := Apply(got, root, home); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(home, ".ssh", "config"))
	if strings.Contains(string(b), "/old-home") {
		t.Fatal("old home in SSH")
	}
	prefs, _ := os.ReadFile(filepath.Join(root, ".application-restore", "preferences.json"))
	var marker struct {
		Values map[string]string `json:"values"`
	}
	if err := json.Unmarshal(prefs, &marker); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(marker.Values["ipannel.settings.v1"], "/old-home") {
		t.Fatal("old home in preferences")
	}
}

func TestArchiveRejectsUnsafeAndCorruptEntries(t *testing.T) {
	for _, p := range []string{"data/../../outside", "ssh/../outside", "data/C:/bad", "data/application-backups/self.zip", "data/.application-restore/pending.zip", "data\\escape", "other/file"} {
		s := fixture(t)
		if err := s.Add(p, []byte("x"), 0600, false); err == nil {
			t.Fatalf("accepted %s", p)
		}
	}
	s := fixture(t)
	s.Files["data/panel.json"] = []byte(`{"hosts":[]}`)
	if err := s.Validate(); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
	path := filepath.Join(t.TempDir(), "evil.zip")
	f, _ := os.Create(path)
	z := zip.NewWriter(f)
	w, _ := z.Create("../outside")
	w.Write([]byte("x"))
	z.Close()
	f.Close()
	if _, _, err := Read(path); err == nil {
		t.Fatal("zip traversal accepted")
	}
}

func TestRestoreRollsBackEarlierWrites(t *testing.T) {
	s := fixture(t)
	s.Add("data/a.json", []byte(`{"saved":true}`), 0600, true)
	s.Add("data/z/child.json", []byte(`{}`), 0600, true)
	home := t.TempDir()
	root := filepath.Join(home, "data")
	put(t, filepath.Join(root, "panel.json"), `{"hosts":[],"groups":[]}`)
	put(t, filepath.Join(root, "a.json"), `{"current":true}`)
	writes := 0
	if err := apply(s, root, home, func(p string, b []byte, mode fs.FileMode) error {
		writes++
		if strings.Contains(p, filepath.Join("z", "child.json")) {
			return fmt.Errorf("injected disk failure")
		}
		return atomicWrite(p, b, mode)
	}); err == nil {
		t.Fatal("expected blocked directory failure")
	}
	if writes < 3 {
		t.Fatalf("failure occurred before earlier writes: %d", writes)
	}
	b, _ := os.ReadFile(filepath.Join(root, "a.json"))
	if string(b) != `{"current":true}` {
		t.Fatalf("earlier write not rolled back: %s", b)
	}
}

func TestRestoreRefusesSymlinkWithoutTouchingTarget(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink requires elevation")
	}
	s := fixture(t)
	s.Add("ssh/config", []byte("NEW"), 0600, true)
	home := t.TempDir()
	root := filepath.Join(home, "data")
	os.MkdirAll(root, 0700)
	other := t.TempDir()
	put(t, filepath.Join(other, "config"), "KEEP")
	if err := os.Symlink(other, filepath.Join(home, ".ssh")); err != nil {
		t.Fatal(err)
	}
	if err := Apply(s, root, home); err == nil {
		t.Fatal("symlink accepted")
	}
	b, _ := os.ReadFile(filepath.Join(other, "config"))
	if string(b) != "KEEP" {
		t.Fatal("outside target modified")
	}
}
