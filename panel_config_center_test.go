package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
)

func TestEditablePanelStateMasksAndPreservesPassword(t *testing.T) {
	base := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts:   []panelstore.PanelHost{{Alias: "prod", HostName: "10.0.0.1", User: "root", Port: "22", Password: "secret"}},
		Groups:  []panelstore.PanelGroup{},
	}
	draft := (&App{}).editablePanelState(base)
	if got := draft.Hosts[0].Password; got != panelPasswordMask {
		t.Fatalf("password was not masked: %q", got)
	}
	next, err := stateFromPanelDraft(base, draft)
	if err != nil {
		t.Fatal(err)
	}
	if next.Hosts[0].Password != "secret" {
		t.Fatalf("masked password was not preserved: %q", next.Hosts[0].Password)
	}
	draft.Hosts[0].Note = "database"
	next, err = stateFromPanelDraft(base, draft)
	if err != nil {
		t.Fatal(err)
	}
	if next.Hosts[0].Note != "database" || next.Hosts[0].Password != "secret" {
		t.Fatalf("metadata edit changed sensitive state: %+v", next.Hosts[0])
	}
	draft.Hosts[0].Password = ""
	next, err = stateFromPanelDraft(base, draft)
	if err != nil {
		t.Fatal(err)
	}
	if next.Hosts[0].Password != "" {
		t.Fatalf("clearing password did not clear it: %q", next.Hosts[0].Password)
	}
}

func TestEditablePanelJSONDoesNotContainPlaintextPassword(t *testing.T) {
	state := panelstore.State{Hosts: []panelstore.PanelHost{{Alias: "prod", Password: "secret"}}}
	draft := (&App{}).editablePanelState(state)
	b, err := json.Marshal(draft)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) == "" || contains(string(b), "secret") {
		t.Fatalf("editable JSON leaked password: %s", b)
	}
	if !contains(string(b), panelPasswordMask) {
		t.Fatalf("editable JSON did not contain the password mask: %s", b)
	}
}

func TestChangedConnectionAliasesIgnorePanelMetadata(t *testing.T) {
	before := []panelstore.PanelHost{{Alias: "prod", HostName: "10.0.0.1", User: "root", Port: "22", Password: "secret", Note: "old", GroupID: "one", Order: 1}}
	after := []panelstore.PanelHost{{Alias: "prod", HostName: "10.0.0.1", User: "root", Port: "22", Password: "secret", Note: "new", GroupID: "two", Order: 0}}
	if got := changedConnectionAliases(before, after); len(got) != 0 {
		t.Fatalf("metadata-only edit triggered connectivity test: %v", got)
	}
	after[0].HostName = "10.0.0.2"
	after = append(after, panelstore.PanelHost{Alias: "new", HostName: "10.0.0.3", User: "root", Port: "22"})
	got := changedConnectionAliases(before, after)
	if len(got) != 2 || got[0] != "new" || got[1] != "prod" {
		t.Fatalf("connection impact set incorrect: %v", got)
	}
}

func TestConfigFilesHashIsOrderInvariant(t *testing.T) {
	left := []panelsync.ConfigFile{{Path: "config", Content: "Host a\n", Mode: 0600, SHA256: "a"}, {Path: "config.d/prod.conf", Content: "Host b\n", Mode: 0600, SHA256: "b"}}
	right := []panelsync.ConfigFile{left[1], left[0]}
	if configFilesHash(left) != configFilesHash(right) {
		t.Fatal("config hash depends on file traversal order")
	}
	right[0].Content = "Host changed\n"
	if configFilesHash(left) == configFilesHash(right) {
		t.Fatal("config hash ignored changed file content when SHA was stale")
	}
}

func TestControlledPanelPathRejectsOutsidePath(t *testing.T) {
	root := t.TempDir()
	store, err := panelstore.NewStoreAt(filepath.Join(root, "panel.json"))
	if err != nil {
		t.Fatal(err)
	}
	a := &App{panelStore: store}
	if _, err := a.controlledPanelPath(filepath.Join(root, "not-allowed.txt")); err == nil {
		t.Fatal("outside path was accepted")
	}
	if _, err := a.controlledPanelPath("panel.json"); err != nil {
		t.Fatalf("panel.json alias was rejected: %v", err)
	}
}

func TestPruneBackupsKeepsNewestAutomaticSnapshots(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	for i := 0; i < 3; i++ {
		path := filepath.Join(root, string(rune('a'+i)))
		if err := os.MkdirAll(filepath.Join(path, "config"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "panel.json"), []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "manifest.json"), []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
		stamp := now.Add(time.Duration(i) * time.Minute)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	if err := panelsync.PruneBackups(root, 2); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected two backups after pruning, got %d", len(entries))
	}
	if _, err := os.Stat(filepath.Join(root, "a")); !os.IsNotExist(err) {
		t.Fatal("oldest backup was not pruned")
	}
}

func contains(value, needle string) bool {
	return len(needle) > 0 && len(value) >= len(needle) && stringIndex(value, needle) >= 0
}

func stringIndex(value, needle string) int {
	for i := 0; i+len(needle) <= len(value); i++ {
		if value[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
