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
	if err := apply(s, root, home, runtime.GOOS, func(p string, b []byte, mode fs.FileMode) error {
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

func TestRestoreRewritesForeignPaths(t *testing.T) {
	s := &Snapshot{Manifest: Manifest{
		Format: Format, Version: 1, SourceOS: "windows",
		SourceHome:    `C:\Users\alice`,
		SourceDataDir: `C:\Users\alice\AppData\Roaming\ServerPanel`,
		Preferences: map[string]string{
			"ipannel.settings.v1": `{"directory":"C:\\Users\\alice\\AppData\\Roaming\\ServerPanel\\work","note":"keep\\slash"}`,
		},
		Relocations: map[string]string{
			`D:\keys\deploy.key`: `C:\Users\alice\.ssh\1panel-keys\abc-deploy.key`,
		},
	}}
	panel := `{"version":1,"hosts":[{"alias":"web","hostName":"192.0.2.10","identityFiles":["c:\\users\\alice\\.ssh\\id_work","~\\.ssh\\id_ed25519"],"extraOptions":[{"key":"UseKeychain","value":"yes"},{"key":"ControlMaster","value":"auto"}],"identityAgent":"~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"}],"groups":[]}`
	if err := s.Add("data/panel.json", []byte(panel), 0600, true); err != nil {
		t.Fatal(err)
	}
	ssh := "Host web\r\n    IdentityFile c:\\users\\alice\\.ssh\\id_work\r\n    IdentityFile \"D:\\keys\\deploy.key\"\r\n    IdentityFile ~\\.ssh\\id_ed25519\r\n    UseKeychain yes\r\n    ControlMaster auto\r\n    IdentityAgent ~/Library/Group Containers/agent.sock\r\n# 1PANNEL-GENERATED\r\n"
	if err := s.Add("ssh/config", []byte(ssh), 0600, true); err != nil {
		t.Fatal(err)
	}
	if err := s.Add("ssh/1panel-keys/abc-deploy.key", []byte("EXTERNAL"), 0600, false); err != nil {
		t.Fatal(err)
	}
	home := t.TempDir()
	root := filepath.Join(home, "data")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := apply(s, root, home, "linux", atomicWrite); err != nil {
		t.Fatal(err)
	}
	panelOut, err := os.ReadFile(filepath.Join(root, "panel.json"))
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Hosts []struct {
			IdentityFiles []string `json:"identityFiles"`
			IdentityAgent string   `json:"identityAgent"`
			ExtraOptions  []struct {
				Key string `json:"key"`
			} `json:"extraOptions"`
		} `json:"hosts"`
	}
	if err := json.Unmarshal(panelOut, &state); err != nil {
		t.Fatal(err)
	}
	if len(state.Hosts) != 1 {
		t.Fatalf("hosts: %s", panelOut)
	}
	gotIDs := strings.Join(state.Hosts[0].IdentityFiles, ",")
	if strings.Contains(strings.ToLower(gotIDs), "users/alice") || strings.Contains(gotIDs, `\`) || !strings.Contains(gotIDs, "/.ssh/id_work") || !strings.Contains(gotIDs, "~/.ssh/id_ed25519") {
		t.Fatalf("identity files: %s", gotIDs)
	}
	if state.Hosts[0].IdentityAgent != "" {
		t.Fatalf("mac agent kept: %s", state.Hosts[0].IdentityAgent)
	}
	keys := []string{}
	for _, opt := range state.Hosts[0].ExtraOptions {
		keys = append(keys, opt.Key)
	}
	joined := strings.Join(keys, ",")
	if strings.Contains(joined, "UseKeychain") || !strings.Contains(joined, "ControlMaster") {
		t.Fatalf("options on linux: %s", joined)
	}
	cfg, err := os.ReadFile(filepath.Join(home, ".ssh", "config"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(cfg)
	if strings.Contains(text, "\r") || strings.Contains(strings.ToLower(text), `users/alice`) || strings.Contains(text, "UseKeychain") || strings.Contains(text, "IdentityAgent") || !strings.Contains(text, "ControlMaster") || !strings.Contains(text, "/.ssh/id_work") || !strings.Contains(text, "/.ssh/1panel-keys/abc-deploy.key") || !strings.Contains(text, "~/.ssh/id_ed25519") || !strings.Contains(text, "# 1PANNEL-GENERATED") {
		t.Fatalf("ssh config: %q", text)
	}
	key, err := os.ReadFile(filepath.Join(home, ".ssh", "1panel-keys", "abc-deploy.key"))
	if err != nil || string(key) != "EXTERNAL" {
		t.Fatalf("external key: %s %v", key, err)
	}
	prefs, err := os.ReadFile(filepath.Join(root, ".application-restore", "preferences.json"))
	if err != nil {
		t.Fatal(err)
	}
	var marker struct {
		Values map[string]string `json:"values"`
	}
	if err := json.Unmarshal(prefs, &marker); err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Directory string `json:"directory"`
		Note      string `json:"note"`
	}
	if err := json.Unmarshal([]byte(marker.Values["ipannel.settings.v1"]), &settings); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(settings.Directory, "AppData") || strings.Contains(settings.Directory, `C:`) || !strings.HasSuffix(settings.Directory, "/work") || settings.Note != `keep\slash` {
		t.Fatalf("preferences: %+v", settings)
	}

	mac := &Snapshot{Manifest: Manifest{
		Format: Format, Version: 1, SourceOS: "darwin",
		SourceHome:    "/Users/alice",
		SourceDataDir: "/Users/alice/Library/Application Support/ServerPanel",
		Preferences:   map[string]string{"ipannel.settings.v1": `{"directory":"/Users/alice/Library/Application Support/ServerPanel/work"}`},
	}}
	if err := mac.Add("data/panel.json", []byte(`{"version":1,"hosts":[{"alias":"web","hostName":"192.0.2.10","identityFiles":["/Users/alice/.ssh/id_work"],"extraOptions":[{"key":"ControlMaster","value":"auto"}]}],"groups":[]}`), 0600, true); err != nil {
		t.Fatal(err)
	}
	winHome := t.TempDir()
	winRoot := filepath.Join(winHome, "data")
	if err := os.MkdirAll(winRoot, 0700); err != nil {
		t.Fatal(err)
	}
	if err := apply(mac, winRoot, winHome, "windows", atomicWrite); err != nil {
		t.Fatal(err)
	}
	winPanel, err := os.ReadFile(filepath.Join(winRoot, "panel.json"))
	if err != nil || strings.Contains(string(winPanel), "/Users/alice") || strings.Contains(string(winPanel), "ControlMaster") {
		t.Fatalf("darwin backup on windows: %s %v", winPanel, err)
	}
	winPrefs, err := os.ReadFile(filepath.Join(winRoot, ".application-restore", "preferences.json"))
	if err != nil || strings.Contains(string(winPrefs), "Application Support") || !strings.Contains(string(winPrefs), "/work") {
		t.Fatalf("darwin preferences on windows: %s %v", winPrefs, err)
	}
	if got := dropIncompatibleSSH("    ControlPath ~/.ssh/cm\n    ControlPersist 5m\n", "linux"); !strings.Contains(got, "ControlPath") || !strings.Contains(got, "ControlPersist") {
		t.Fatalf("linux should keep multiplexing: %q", got)
	}
}
