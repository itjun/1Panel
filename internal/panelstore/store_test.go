package panelstore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreRoundTripIsAtomicAndPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "panel.json")
	s, err := NewStoreAt(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Replace(State{
		Version: CurrentVersion,
		Hosts:   []PanelHost{{Alias: "prod", HostName: "10.0.0.1", User: "root", Password: "secret"}},
	}); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := st.Mode().Perm(); got != 0600 {
		t.Fatalf("panel.json mode=%o, want 600", got)
	}

	s2, err := NewStoreAt(path)
	if err != nil {
		t.Fatal(err)
	}
	h, ok := s2.GetHost("prod")
	if !ok || h.Password != "secret" || h.HostName != "10.0.0.1" {
		t.Fatalf("round trip lost host: %#v, ok=%v", h, ok)
	}
}

func TestStoreRejectsDuplicateAliases(t *testing.T) {
	s, err := NewStoreAt(filepath.Join(t.TempDir(), "panel.json"))
	if err != nil {
		t.Fatal(err)
	}
	err = s.Replace(State{Version: CurrentVersion, Hosts: []PanelHost{{Alias: "a"}, {Alias: "a"}}})
	if err == nil {
		t.Fatal("expected duplicate alias error")
	}
}

func TestStoreQuarantinesCorruptJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "panel.json")
	if err := os.WriteFile(path, []byte("{not-json"), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := NewStoreAt(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(store.Snapshot().Hosts) != 0 {
		t.Fatal("corrupt store should recover to an empty state without backup")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "panel.json.corrupt.") {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("corrupt panel.json was not quarantined")
	}
}

func TestStoreMigratesLegacyGroupIDsAndConfigPaths(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "panel.json")
	legacy := State{
		Version: CurrentVersion,
		Hosts:   []PanelHost{{Alias: "prod", GroupID: "g_prod"}},
		Groups:  []PanelGroup{{ID: "g_prod", Name: "01-production"}},
		ConfigLayout: ConfigLayout{
			Files:          []ConfigFile{{Path: "config.d/g_prod.conf", Content: "# generated\n"}},
			GeneratedFiles: []string{"config", "config.d/g_prod.conf"},
		},
	}
	b, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}

	store, err := NewStoreAt(path)
	if err != nil {
		t.Fatal(err)
	}
	got := store.Snapshot()
	if got.Groups[0].ID != "01-production" || got.Groups[0].Name != "01-production" {
		t.Fatalf("group was not migrated: %#v", got.Groups)
	}
	if got.Hosts[0].GroupID != "01-production" {
		t.Fatalf("host group was not migrated: %q", got.Hosts[0].GroupID)
	}
	if got.ConfigLayout.Files[0].Path != "config.d/01-production.conf" || got.ConfigLayout.GeneratedFiles[1] != "config.d/01-production.conf" {
		t.Fatalf("config paths were not migrated: %#v / %#v", got.ConfigLayout.Files, got.ConfigLayout.GeneratedFiles)
	}

	persisted, err := LoadStateFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Groups[0].ID != "01-production" {
		t.Fatalf("migrated state was not persisted: %#v", persisted.Groups)
	}
}
