package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"diteng-pannel/internal/panelstore"
)

func TestRecoverPanelGroupMetadataFromBackup(t *testing.T) {
	root := t.TempDir()
	panelPath := filepath.Join(root, "panel.json")
	backupDir := filepath.Join(root, "backups", "20260922-190000-good")
	if err := os.MkdirAll(backupDir, 0700); err != nil {
		t.Fatal(err)
	}
	backup := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts: []panelstore.PanelHost{
			{Alias: "one", HostName: "10.0.0.1", GroupID: "01-production", Order: 1},
			{Alias: "two", HostName: "10.0.0.2", GroupID: "01-production", Order: 2},
		},
		Groups: []panelstore.PanelGroup{{ID: "01-production", Name: "01-production"}},
	}
	data, err := json.Marshal(backup)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backupDir, "panel.json"), data, 0600); err != nil {
		t.Fatal(err)
	}

	current := panelstore.State{
		Version:     panelstore.CurrentVersion,
		ConfigStale: true,
		LastError:   "SSH 配置已被外部修改，请先导入差异后再生成",
		Hosts: []panelstore.PanelHost{
			{Alias: "one", HostName: "10.0.0.1"},
			{Alias: "two", HostName: "10.0.0.2"},
		},
		Groups: []panelstore.PanelGroup{{ID: "01-production", Name: "01-production"}},
	}
	recovered, changed := recoverPanelGroupMetadata(panelPath, current)
	if !changed {
		t.Fatal("expected group metadata recovery")
	}
	if recovered.Hosts[0].GroupID != "01-production" || recovered.Hosts[1].Order != 2 {
		t.Fatalf("recovered group metadata = %#v", recovered.Hosts)
	}
	if recovered.Hosts[0].HostName != "10.0.0.1" {
		t.Fatalf("connection fields were unexpectedly replaced: %#v", recovered.Hosts[0])
	}
}

func TestBootstrapPersistsStaleFlagRecovery(t *testing.T) {
	before := panelstore.State{
		Version:     panelstore.CurrentVersion,
		ConfigStale: true,
		LastError:   "SSH 配置已被外部修改，请先导入差异后再生成",
		Hosts:       []panelstore.PanelHost{{Alias: "prod"}},
	}
	after := before
	after.ConfigStale = false
	after.LastError = ""
	if !shouldPersistPanelBootstrap(before, after, true, false, false) {
		t.Fatal("clearing a recovered stale flag must be persisted")
	}
	if shouldPersistPanelBootstrap(after, after, true, false, false) {
		t.Fatal("an unchanged bootstrap state should not be rewritten")
	}
}

func TestStalePanelStateDoesNotAutoImportSSHConfig(t *testing.T) {
	state := panelstore.State{ConfigStale: true}
	if shouldImportPanelConfigAtStartup(state) {
		t.Fatal("config-stale Panel state must not import the old SSH config automatically")
	}
	if !shouldImportPanelConfigAtStartup(panelstore.State{}) {
		t.Fatal("a synchronized Panel state should still allow startup drift import")
	}
}
