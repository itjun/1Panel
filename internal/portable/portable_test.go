package portable

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"diteng-pannel/internal/panelstore"
)

func TestNormalizePath(t *testing.T) {
	cases := []struct {
		p, home, want string
		inside        bool
	}{
		{"~/.ssh/id_rsa", "/Users/a", "~/.ssh/id_rsa", true},
		{`~\.ssh\id_rsa`, `C:\Users\a`, "~/.ssh/id_rsa", true},
		{"%d/.ssh/id_ed25519", "/home/a", "~/.ssh/id_ed25519", true},
		{".ssh/id_rsa", "/home/a", "~/.ssh/id_rsa", true},
		{"/Users/a/.ssh/id_rsa", "/Users/a", "~/.ssh/id_rsa", true},
		{`C:\Users\A\.ssh\id_rsa`, `c:\users\a`, "~/.ssh/id_rsa", true},
		{`"/Users/a/keys/k.pem"`, "/Users/a", "~/keys/k.pem", true},
		{"/opt/keys/k.pem", "/Users/a", "/opt/keys/k.pem", false},
		{"/Users/ab/.ssh/x", "/Users/a", "/Users/ab/.ssh/x", false},
		{"~/.ssh/%h.key", "/Users/a", "~/.ssh/%h.key", true},
		{"/etc/%h.key", "/Users/a", "/etc/%h.key", false},
	}
	for _, c := range cases {
		got, inside := NormalizePath(c.p, c.home)
		if got != c.want || inside != c.inside {
			t.Errorf("NormalizePath(%q,%q)=%q,%v want %q,%v", c.p, c.home, got, inside, c.want, c.inside)
		}
	}
}

func TestGuessSSHRelative(t *testing.T) {
	if got, ok := GuessSSHRelative(`C:\Users\x\.ssh\work\id`); !ok || got != "~/.ssh/work/id" {
		t.Fatalf("got %q %v", got, ok)
	}
	if _, ok := GuessSSHRelative("/opt/key"); ok {
		t.Fatal("expected no guess")
	}
}

func TestSafeRel(t *testing.T) {
	for _, bad := range []string{"", "../x", "a/../../x", "/abs", `C:\x`, `a\b`, "a//b"} {
		if SafeRel(bad) {
			t.Errorf("SafeRel(%q) should be false", bad)
		}
	}
	if !SafeRel(".ssh/id_rsa") {
		t.Error("expected safe")
	}
}

func TestAdaptHostForOS(t *testing.T) {
	h := panelstore.PanelHost{
		Alias:         "web",
		IdentityAgent: "~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock",
		ExtraOptions: []panelstore.SSHOption{
			{Key: "UseKeychain", Value: "yes"},
			{Key: "ControlMaster", Value: "auto"},
			{Key: "ServerAliveInterval", Value: "30"},
		},
	}
	mac, dropped := AdaptHostForOS(h, "darwin")
	if len(dropped) != 0 || mac.IdentityAgent == "" || len(mac.ExtraOptions) != 3 {
		t.Fatalf("darwin should keep everything: %+v %v", mac, dropped)
	}
	linux, dropped := AdaptHostForOS(h, "linux")
	if linux.IdentityAgent != "" || len(linux.ExtraOptions) != 2 || len(dropped) != 2 {
		t.Fatalf("linux: %+v %v", linux, dropped)
	}
	win, dropped := AdaptHostForOS(h, "windows")
	if len(win.ExtraOptions) != 1 || win.ExtraOptions[0].Key != "ServerAliveInterval" || len(dropped) != 3 {
		t.Fatalf("windows: %+v %v", win, dropped)
	}
}

func TestArchiveRoundTrip(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "b.zip")
	a := &Archive{Manifest: Manifest{
		SourceOS: "darwin",
		Hosts:    []panelstore.PanelHost{{Alias: "web", HostName: "1.2.3.4", Password: "p", IdentityFiles: []string{"~/.ssh/id_rsa"}}},
		Groups:   []panelstore.PanelGroup{{ID: "prod", Name: "prod"}},
	}, KnownHosts: []byte("1.2.3.4 ssh-ed25519 AAAA\n")}
	if _, err := a.AddKey(".ssh/id_rsa", []byte("PRIVATE"), 0600); err != nil {
		t.Fatal(err)
	}
	a.AddRawConfig("config", []byte("Host web\n"))
	a.AddRawConfig("/etc/ssh/ssh_config", []byte("x"))
	if err := Write(dst, a); err != nil {
		t.Fatal(err)
	}
	if !IsZip(dst) {
		t.Fatal("expected zip header")
	}
	got, err := Read(dst)
	if err != nil {
		t.Fatal(err)
	}
	if got.Manifest.Hosts[0].Password != "p" || got.Manifest.Groups[0].ID != "prod" {
		t.Fatalf("manifest mismatch: %+v", got.Manifest)
	}
	if string(got.Keys["keys/.ssh/id_rsa"]) != "PRIVATE" || string(got.KnownHosts) == "" {
		t.Fatalf("payload mismatch: %+v", got)
	}
	if _, ok := got.RawConfig["raw-config/external/ssh_config"]; !ok {
		t.Fatalf("external raw config not sanitized: %v", got.Manifest.RawConfig)
	}
}

func TestReadRejectsPlainZip(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "plain.zip")
	writeZip(t, dst, map[string]string{"readme.txt": "hi"})
	if _, err := Read(dst); !errors.Is(err, ErrNotPortable) {
		t.Fatalf("want ErrNotPortable, got %v", err)
	}
	writeZip(t, dst, map[string]string{"manifest.json": `{"format":"other"}`})
	if _, err := Read(dst); !errors.Is(err, ErrNotPortable) {
		t.Fatalf("want ErrNotPortable for foreign manifest, got %v", err)
	}
}

func TestReadRejectsTraversal(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "evil.zip")
	writeZip(t, dst, map[string]string{
		"manifest.json": `{"format":"1panel-portable","version":2}`,
		"../evil":       "x",
	})
	if _, err := Read(dst); err == nil || !strings.Contains(err.Error(), "非法路径") {
		t.Fatalf("want traversal error, got %v", err)
	}
}

func TestMergeKnownHosts(t *testing.T) {
	local := []byte("a ssh-rsa AAA\r\nb ssh-rsa BBB")
	merged, added := MergeKnownHosts(local, []byte("# c\nb ssh-rsa BBB\nc ssh-rsa CCC\n\nc ssh-rsa CCC\n"))
	if added != 1 || !strings.HasSuffix(string(merged), "\nc ssh-rsa CCC\n") {
		t.Fatalf("added=%d merged=%q", added, merged)
	}
	if _, added := MergeKnownHosts(merged, []byte("c ssh-rsa CCC")); added != 0 {
		t.Fatal("expected idempotent merge")
	}
}

func writeZip(t *testing.T, dst string, files map[string]string) {
	t.Helper()
	f, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(content))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
}
