package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/portable"
	"diteng-pannel/internal/sshd"
)

func newBackupTestApp(t *testing.T, home string) *App {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	store, err := panelstore.NewStoreAt(filepath.Join(home, "data", "panel.json"))
	if err != nil {
		t.Fatal(err)
	}
	return &App{panelStore: store, sshMgr: sshd.NewManager()}
}

func writeTestFile(t *testing.T, path, content string, perm os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), perm); err != nil {
		t.Fatal(err)
	}
}

func TestBuildPortableArchiveNormalizesKeys(t *testing.T) {
	home := t.TempDir()
	writeTestFile(t, filepath.Join(home, ".ssh", "id_work"), "WORK", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "id_work.pub"), "WORK.pub", 0644)
	outside := filepath.Join(t.TempDir(), "deploy.pem")
	writeTestFile(t, outside, "DEPLOY", 0600)

	state := panelstore.State{
		Hosts: []panelstore.PanelHost{
			{Alias: "web", HostName: "10.0.0.1", Password: "pw", IdentityFiles: []string{filepath.Join(home, ".ssh", "id_work"), outside, "~/.ssh/missing"}},
			{Alias: "github.com", HostName: "github.com", User: "git"},
		},
		Groups: []panelstore.PanelGroup{{ID: "prod", Name: "prod"}},
	}
	arc := buildPortableArchive(state, home)
	if len(arc.Manifest.Hosts) != 1 {
		t.Fatalf("git host should be excluded: %+v", arc.Manifest.Hosts)
	}
	got := arc.Manifest.Hosts[0]
	want := []string{"~/.ssh/id_work", "~/.ssh/1panel-keys/deploy.pem", "~/.ssh/missing"}
	if strings.Join(got.IdentityFiles, ",") != strings.Join(want, ",") || got.Password != "pw" {
		t.Fatalf("identity files=%v password=%q", got.IdentityFiles, got.Password)
	}
	if string(arc.Keys["keys/.ssh/id_work"]) != "WORK" || string(arc.Keys["keys/.ssh/id_work.pub"]) != "WORK.pub" ||
		string(arc.Keys["keys/.ssh/1panel-keys/deploy.pem"]) != "DEPLOY" {
		t.Fatalf("keys not packed: %v", arc.Manifest.Keys)
	}
}

func TestPlanRestoreRenamesConflictingKey(t *testing.T) {
	home := t.TempDir()
	writeTestFile(t, filepath.Join(home, ".ssh", "id_work"), "LOCAL", 0600)
	arc := &portable.Archive{Manifest: portable.Manifest{Hosts: []panelstore.PanelHost{{
		Alias: "web", IdentityFiles: []string{"~/.ssh/id_work"},
		ExtraOptions: []panelstore.SSHOption{{Key: "UseKeychain", Value: "yes"}},
	}}}}
	if _, err := arc.AddKey(".ssh/id_work", []byte("REMOTE"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := arc.AddKey(".ssh/id_work.pub", []byte("REMOTE.pub"), 0644); err != nil {
		t.Fatal(err)
	}
	plan, err := planRestore(arc, home, "linux")
	if err != nil {
		t.Fatal(err)
	}
	identity := plan.hosts[0].IdentityFiles[0]
	if !strings.HasPrefix(identity, "~/.ssh/id_work.1panel-") {
		t.Fatalf("identity not renamed: %s", identity)
	}
	if len(plan.keys) != 2 || plan.keys[1].display != identity+".pub" {
		t.Fatalf("key writes: %+v", plan.keys)
	}
	if len(plan.dropped) != 1 || len(plan.hosts[0].ExtraOptions) != 0 {
		t.Fatalf("UseKeychain not dropped on linux: %v", plan.dropped)
	}
}

func TestMergeRestoreKeepsLocalAndFixesGroups(t *testing.T) {
	current := panelstore.State{
		Hosts:  []panelstore.PanelHost{{Alias: "web", HostName: "old", Password: "local"}},
		Groups: []panelstore.PanelGroup{{ID: "prod", Name: "prod"}},
	}
	plan := &restorePlan{
		hosts: []panelstore.PanelHost{
			{Alias: "web", HostName: "new", GroupID: "prod"},
			{Alias: "db", HostName: "10.0.0.2", GroupID: "missing"},
		},
		groups: []panelstore.PanelGroup{{ID: "prod", Name: "prod", ParentID: "ghost"}, {ID: "a", Name: "a", ParentID: "b"}, {ID: "b", Name: "b", ParentID: "a"}},
	}
	res := &ImportResult{}
	skip := mergeRestore(current, plan, false, res)
	if current.Hosts[0].HostName != "old" || skip.Hosts[0].HostName != "old" || len(res.Skipped) != 1 || len(res.Added) != 1 {
		t.Fatalf("skip mode: %+v %+v", skip.Hosts, res)
	}
	if skip.Hosts[1].GroupID != "" {
		t.Fatalf("missing group should be cleared: %+v", skip.Hosts[1])
	}
	res = &ImportResult{}
	over := mergeRestore(current, plan, true, res)
	if over.Hosts[0].HostName != "new" || over.Hosts[0].Password != "local" || len(res.Overwritten) != 1 {
		t.Fatalf("overwrite mode: %+v", over.Hosts[0])
	}
	if current.Hosts[0].HostName != "old" {
		t.Fatal("merge must not mutate the rollback snapshot")
	}
	for _, g := range over.Groups {
		if g.ParentID == "ghost" {
			t.Fatal("dangling parent kept")
		}
	}
	if over.Groups[1].ParentID != "" && over.Groups[2].ParentID != "" {
		t.Fatalf("parent cycle kept: %+v", over.Groups)
	}
}

func TestBackupRoundTripAcrossHomes(t *testing.T) {
	if _, err := exec.LookPath("ssh"); err != nil {
		t.Skip("ssh 不可用")
	}
	srcHome := t.TempDir()
	src := newBackupTestApp(t, srcHome)
	writeTestFile(t, filepath.Join(srcHome, ".ssh", "id_work"), "WORK-KEY", 0600)
	writeTestFile(t, filepath.Join(srcHome, ".ssh", "known_hosts"), "10.0.0.1 ssh-ed25519 AAAA\n", 0600)
	if err := src.panelStore.Replace(panelstore.State{
		Hosts: []panelstore.PanelHost{{
			Alias: "web", HostName: "10.0.0.1", User: "root", Password: "pw",
			IdentityFiles: []string{filepath.Join(srcHome, ".ssh", "id_work")}, GroupID: "prod",
		}},
		Groups: []panelstore.PanelGroup{{ID: "prod", Name: "prod"}},
	}); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "backup")
	msg, err := (*Backup)(src).ExportBackup(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(msg, "1 台主机") {
		t.Fatalf("summary: %s", msg)
	}
	zipPath := out + ".zip"

	dstHome := t.TempDir()
	dst := newBackupTestApp(t, dstHome)
	writeTestFile(t, filepath.Join(dstHome, ".ssh", "id_work"), "OTHER-KEY", 0600)
	preview, err := (*Backup)(dst).PreviewBackup(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Hosts != 1 || !preview.IncludesPasswords || len(preview.KeyRenames) != 1 || !preview.KnownHosts {
		t.Fatalf("preview: %+v", preview)
	}
	res, err := (*Backup)(dst).RestoreBackup(zipPath, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Added) != 1 || res.Keys != 1 || res.KnownHosts != 1 {
		t.Fatalf("result: %+v", res)
	}
	host, ok := dst.panelStore.GetHost("web")
	if !ok || host.Password != "pw" || host.GroupID != "prod" {
		t.Fatalf("restored host: %+v", host)
	}
	rel, ok := portable.RelFromTilde(host.IdentityFiles[0])
	if !ok || !strings.HasPrefix(rel, ".ssh/id_work.1panel-") {
		t.Fatalf("identity: %v", host.IdentityFiles)
	}
	if b, err := os.ReadFile(filepath.Join(dstHome, filepath.FromSlash(rel))); err != nil || string(b) != "WORK-KEY" {
		t.Fatalf("key file: %q %v", b, err)
	}
	if b, _ := os.ReadFile(filepath.Join(dstHome, ".ssh", "id_work")); string(b) != "OTHER-KEY" {
		t.Fatal("local key overwritten")
	}
	config, err := os.ReadFile(filepath.Join(dstHome, ".ssh", "config.d", "prod.conf"))
	if err != nil || !strings.Contains(string(config), "Host web") || strings.Contains(string(config), srcHome) {
		t.Fatalf("generated config: %s %v", config, err)
	}
}

func TestRestoreLegacyJSON(t *testing.T) {
	if _, err := exec.LookPath("ssh"); err != nil {
		t.Skip("ssh 不可用")
	}
	home := t.TempDir()
	a := newBackupTestApp(t, home)
	legacy := filepath.Join(t.TempDir(), "serverpanel-backup.json")
	writeTestFile(t, legacy, `{"version":1,"exportedAt":1,
		"hosts":[{"name":"old","hostName":"10.0.0.9","user":"root","port":"22","identityFile":"/Users/x/.ssh/id_rsa","password":"pw"}],
		"groups":[{"id":"g_1","name":"dev","order":0,"hosts":["old"]}]}`, 0600)
	res, err := (*Backup)(a).RestoreBackup(legacy, false)
	if err != nil {
		t.Fatal(err)
	}
	host, ok := a.panelStore.GetHost("old")
	if len(res.Added) != 1 || !ok || host.GroupID != "dev" || host.Password != "pw" || host.IdentityFiles[0] != "~/.ssh/id_rsa" {
		t.Fatalf("legacy restore: %+v %+v", res, host)
	}
}

func TestLoadBackupRejectsForeignFiles(t *testing.T) {
	dir := t.TempDir()
	notJSON := filepath.Join(dir, "x.json")
	writeTestFile(t, notJSON, `{"hello":1}`, 0600)
	if _, _, err := loadBackup(notJSON); err == nil {
		t.Fatal("expected rejection")
	}
}
