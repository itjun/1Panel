package main

import (
	"testing"

	"diteng-pannel/internal/panelstore"
)

func TestRenamePanelGroupMigratesReferencesAndKeepsOldGeneratedPath(t *testing.T) {
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Groups: []panelstore.PanelGroup{
			{ID: "03-zhetai", Name: "03-zhetai", Order: 4},
			{ID: "02-private", Name: "02-private", Order: 5},
		},
		Hosts: []panelstore.PanelHost{
			{Alias: "zhetai-postgres", GroupID: "03-zhetai", Order: 0},
			{Alias: "zhetai-data", GroupID: "03-zhetai", Order: 1},
		},
		ConfigLayout: panelstore.ConfigLayout{
			Files:          []panelstore.ConfigFile{{Path: "config.d/03-zhetai.conf", Content: "# keep"}},
			GeneratedFiles: []string{"config", "config.d/03-zhetai.conf"},
		},
	}

	if err := renamePanelGroup(&state, "03-zhetai", "03-zhetai-main"); err != nil {
		t.Fatal(err)
	}
	if panelGroupIndex(state, "03-zhetai") >= 0 {
		t.Fatal("old group ID was retained")
	}
	if panelGroupIndex(state, "03-zhetai-main") < 0 {
		t.Fatal("renamed group is missing")
	}
	for _, host := range state.Hosts {
		if host.GroupID != "03-zhetai-main" {
			t.Fatalf("host %s retained old group ID %q", host.Alias, host.GroupID)
		}
	}
	if len(state.ConfigLayout.Files) != 2 || state.ConfigLayout.Files[0].Path != "config.d/03-zhetai.conf" || state.ConfigLayout.Files[1].Path != "config.d/03-zhetai-main.conf" {
		t.Fatalf("config snapshot paths=%v", state.ConfigLayout.Files)
	}
	if got := state.ConfigLayout.GeneratedFiles[1]; got != "config.d/03-zhetai.conf" {
		t.Fatalf("old generated path=%q; generator must remove it", got)
	}
}

func TestPanelGroupRenameRejectsMissingLegacyCacheIndependently(t *testing.T) {
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Groups:  []panelstore.PanelGroup{{ID: "03-zhetai-main", Name: "03-zhetai-main"}},
	}

	// The Panel model is the lookup source used by the service. This regression
	// case represents groups.json having already been migrated to another ID.
	if err := renamePanelGroup(&state, "03-zhetai-main", "03-zhetai"); err != nil {
		t.Fatalf("Panel group rename should not depend on groups.json: %v", err)
	}
	if panelGroupIndex(state, "03-zhetai") < 0 {
		t.Fatal("Panel group was not renamed")
	}
}
