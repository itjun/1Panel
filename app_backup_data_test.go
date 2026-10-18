package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"diteng-pannel/internal/appbackup"
	"diteng-pannel/internal/panelstore"
)

func TestApplicationBackupRestoresCompleteData(t *testing.T) {
	home := t.TempDir()
	a := newBackupTestApp(t, home)
	service := (*Backup)(a)
	root := filepath.Dir(a.panelStore.Path())
	state := panelstore.State{Hosts: []panelstore.PanelHost{{Alias: "web", HostName: "192.0.2.10", Password: "saved-password", GroupID: "prod", IdentityFiles: []string{"~/.ssh/id_work"}}, {Alias: "github.com", HostName: "github.com", User: "git"}}, Groups: []panelstore.PanelGroup{{ID: "prod", Name: "prod"}}}
	if err := a.panelStore.Replace(state); err != nil {
		t.Fatal(err)
	}
	data := map[string]string{"notify_subs.json": `{"wecomWebhook":"secret","enabled":true}`, "alert_history.v2.json": `[{"id":"alarm","read":true}]`, "speedtest_history.json": `[{"id":"speed","samples":[1,2,3]}]`, "app_sessions.json": `[{"id":"session"}]`, "theme.json": `{"appearance":"dark"}`, "window.json": `{"width":1200}`, "custom/future.json": `{"future":"retained"}`, "backups/previous.json": `{"revision":1}`}
	for name, content := range data {
		writeTestFile(t, filepath.Join(root, name), content, 0600)
	}
	writeTestFile(t, filepath.Join(root, "update", "download"), "CACHE", 0600)
	writeTestFile(t, filepath.Join(root, "writing.tmp"), "TEMP", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "config"), "Include config.d/*.conf\n", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "config.d", "prod.conf"), "Host web\n HostName 192.0.2.10\n IdentityFile ~/.ssh/id_work\n", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "id_work"), "PRIVATE-KEY", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "known_hosts"), "SAVED-KNOWN-HOST", 0600)
	prefs := map[string]string{"ipannel.settings.v1": `{"appearance":"dark","hostHomeRows":[["prod"]]}`, "1pannel-sidebar-width": "260", "1pannel-react-nav": `{"pinned":["web"]}`}
	export := filepath.Join(t.TempDir(), "full.zip")
	created, err := service.BackupApplicationData(export, prefs)
	if err != nil {
		t.Fatal(err)
	}
	if created.Hosts != 2 || created.Groups != 1 || created.Preferences != 3 || created.SSHFiles != 4 {
		t.Fatalf("summary=%+v", created)
	}
	snap, _, err := appbackup.Read(export)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := snap.Files["data/update/download"]; ok {
		t.Fatal("executable cache packed")
	}
	if _, ok := snap.Files["data/writing.tmp"]; ok {
		t.Fatal("temporary write packed")
	}
	if _, ok := snap.Files["data/backups/previous.json"]; !ok {
		t.Fatal("historical configuration snapshot omitted")
	}
	for name := range data {
		writeTestFile(t, filepath.Join(root, name), `{"changed":true}`, 0600)
	}
	writeTestFile(t, filepath.Join(root, "created-after.json"), `{"later":true}`, 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "id_work"), "CHANGED-KEY", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "unrelated"), "KEEP-ME", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "config.d", "created-after.conf"), "# 1PANNEL-GENERATED\nHost new-host\n HostName 192.0.2.99\n", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "config.d", "manual-after.conf"), "Host unrelated-manual\n HostName 192.0.2.98\n", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "config.d", "mixed-after.conf"), "Host keep-manual\n HostName 192.0.2.97\n# 1PANNEL-GENERATED\nHost remove-generated\n HostName 192.0.2.96\n", 0600)
	preview, err := service.PreviewApplicationBackup(export)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.RestoreApplicationData(export, preview.Fingerprint, map[string]string{"ipannel.settings.v1": `{"appearance":"light"}`}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(home, ".ssh", "id_work")); string(b) != "CHANGED-KEY" {
		t.Fatal("restore mutated live files before restart")
	}
	list, err := service.ListApplicationBackups()
	if err != nil || len(list) != 2 {
		t.Fatalf("safety backup missing: %d %v", len(list), err)
	}
	pending, _, err := appbackup.Read(filepath.Join(root, ".application-restore", "pending.zip"))
	if err != nil {
		t.Fatal(err)
	}
	if err := appbackup.Apply(pending, root, home); err != nil {
		t.Fatal(err)
	}
	for name, content := range data {
		b, err := os.ReadFile(filepath.Join(root, name))
		if err != nil || !jsonEqual(b, []byte(content)) {
			t.Fatalf("%s not restored: %s %v", name, b, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "created-after.json")); !os.IsNotExist(err) {
		t.Fatal("newer application data was not replaced")
	}
	if _, err := os.Stat(filepath.Join(home, ".ssh", "config.d", "created-after.conf")); !os.IsNotExist(err) {
		t.Fatal("newer generated SSH host survived restore")
	}
	if _, err := os.Stat(filepath.Join(home, ".ssh", "config.d", "manual-after.conf")); err != nil {
		t.Fatal("unrelated manual SSH file was removed")
	}
	if b, err := os.ReadFile(filepath.Join(home, ".ssh", "config.d", "mixed-after.conf")); err != nil || !strings.Contains(string(b), "keep-manual") || strings.Contains(string(b), "remove-generated") {
		t.Fatalf("manual prefix not preserved: %s %v", b, err)
	}
	for name, want := range map[string]string{"id_work": "PRIVATE-KEY", "known_hosts": "SAVED-KNOWN-HOST", "unrelated": "KEEP-ME"} {
		b, err := os.ReadFile(filepath.Join(home, ".ssh", name))
		if err != nil || string(b) != want {
			t.Fatalf("SSH %s: %s %v", name, b, err)
		}
	}
	gotPrefs, err := service.RestoredApplicationPreferences()
	if err != nil || gotPrefs == nil || gotPrefs.Values["1pannel-sidebar-width"] != "260" {
		t.Fatalf("preferences=%+v %v", gotPrefs, err)
	}
	if err := service.AcknowledgeApplicationPreferences("wrong"); err == nil {
		t.Fatal("stale preference acknowledgement accepted")
	}
	if err := service.AcknowledgeApplicationPreferences(gotPrefs.ID); err != nil {
		t.Fatal(err)
	}
	if p, err := service.RestoredApplicationPreferences(); err != nil || p != nil {
		t.Fatal("restore preferences not acknowledged")
	}
	if info, err := os.Stat(export); err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("backup permissions: %v %v", info, err)
	}
}

func jsonEqual(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	aa, _ := json.Marshal(x)
	bb, _ := json.Marshal(y)
	return string(aa) == string(bb)
}

func TestApplicationRestoreRejectsChangedPreviewAndLegacyBackup(t *testing.T) {
	home := t.TempDir()
	a := newBackupTestApp(t, home)
	if err := a.panelStore.Replace(panelstore.State{}); err != nil {
		t.Fatal(err)
	}
	service := (*Backup)(a)
	out := filepath.Join(t.TempDir(), "full.zip")
	if _, err := service.BackupApplicationData(out, map[string]string{}); err != nil {
		t.Fatal(err)
	}
	if err := service.RestoreApplicationData(out, "changed", map[string]string{}); err == nil {
		t.Fatal("changed preview accepted")
	}
	if _, err := os.Stat(filepath.Join(home, "data", ".application-restore", "pending.zip")); !os.IsNotExist(err) {
		t.Fatal("invalid preview staged a restore")
	}
	legacy := filepath.Join(t.TempDir(), "old.json")
	writeTestFile(t, legacy, `{"version":1,"hosts":[]}`, 0600)
	if _, err := service.PreviewApplicationBackup(legacy); err == nil {
		t.Fatal("host-only backup mislabelled complete")
	}
}

func TestApplicationSnapshotIncludesExternalReferencedKey(t *testing.T) {
	home := t.TempDir()
	a := newBackupTestApp(t, home)
	outside := filepath.Join(t.TempDir(), "deploy.key")
	writeTestFile(t, outside, "EXTERNAL", 0600)
	writeTestFile(t, outside+"-cert.pub", "CERTIFICATE", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "id_ed25519"), "DEFAULT-KEY", 0600)
	writeTestFile(t, filepath.Join(home, ".ssh", "id_ed25519-cert.pub"), "DEFAULT-CERTIFICATE", 0600)
	if err := a.panelStore.Replace(panelstore.State{Hosts: []panelstore.PanelHost{{Alias: "web", HostName: "192.0.2.1", IdentityFiles: []string{outside}}}}); err != nil {
		t.Fatal(err)
	}
	s, err := collectApplicationSnapshot(filepath.Dir(a.panelStore.Path()), home, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(s.Manifest.Relocations[outside], "1panel-keys") {
		t.Fatalf("relocations=%v", s.Manifest.Relocations)
	}
	if s.Manifest.Relocations[outside+"-cert.pub"] != s.Manifest.Relocations[outside]+"-cert.pub" {
		t.Fatal("external SSH certificate must follow the relocated key basename")
	}
	if string(s.Files["ssh/id_ed25519-cert.pub"]) != "DEFAULT-CERTIFICATE" {
		t.Fatal("default SSH certificate omitted")
	}
	if err := os.Remove(outside); err != nil {
		t.Fatal(err)
	}
	if err := appbackup.Apply(s, filepath.Dir(a.panelStore.Path()), home); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(s.Manifest.Relocations[outside])
	if err != nil || string(b) != "EXTERNAL" {
		t.Fatalf("external key not restored: %s %v", b, err)
	}
	panel, err := os.ReadFile(a.panelStore.Path())
	if err != nil || strings.Contains(string(panel), outside) || !strings.Contains(string(panel), "1panel-keys") {
		t.Fatalf("key reference not remapped: %s %v", panel, err)
	}
}
