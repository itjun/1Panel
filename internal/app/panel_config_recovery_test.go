package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"diteng-pannel/internal/panelstore"
)

func TestResolveMissingSSHConfig(t *testing.T) {
	const mainConfig = "Include config.d/*.conf\nHost build\n    HostName build.example\n    User root\n"
	const missingConfig = "Host gateway\n    HostName gateway.example\n    User root\n"
	for _, source := range []string{"local", "app"} {
		t.Run(source, func(t *testing.T) {
			a := externalRecoveryFixture(t, mainConfig)
			const relative = "config.d/gateways.conf"
			if err := a.panelStore.Update(func(state *panelstore.State) error {
				state.ConfigStale = false
				state.LastError = ""
				state.ConfigLayout.Files = []panelstore.ConfigFile{
					{Path: "config", Content: mainConfig, Mode: 0600, SHA256: panelstore.SHA256([]byte(mainConfig))},
					{Path: relative, Content: missingConfig, Mode: 0600, SHA256: panelstore.SHA256([]byte(missingConfig))},
				}
				state.Groups = []panelstore.PanelGroup{{ID: "gateways", Name: "gateways"}}
				state.Hosts[0].GroupID = "gateways"
				state.Hosts[1].ProxyJump = ""
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			service := (*PanelConfig)(a)
			overview, err := service.GetOverview()
			if err != nil || !overview.NeedsReview || !overview.CanUseLocal || len(overview.Diff.ChangedFiles) != 1 {
				t.Fatalf("incorrect difference before recovery: %+v %v", overview.Diff, err)
			}
			if err := service.ResolveConfigDrift(overview.Revision, overview.ConfigHash, source); err != nil {
				t.Fatal(err)
			}
			root, _ := sshConfigPath()
			present, readErr := os.ReadFile(filepath.Join(filepath.Dir(root), filepath.FromSlash(relative)))
			host, exists := a.panelStore.GetHost("gateway")
			if source == "app" {
				if readErr != nil || string(present) != missingConfig || !exists || host.Note != "keep" {
					t.Fatal("restoring application records did not restore the missing file and retain the host")
				}
			} else if exists || !os.IsNotExist(readErr) {
				t.Fatal("adopting local changes did not remove the host while retaining the local deletion")
			}
			mainBytes, err := os.ReadFile(root)
			if err != nil || string(mainBytes) != mainConfig {
				t.Fatal("the unaffected main configuration changed")
			}
			if current, err := service.GetOverview(); err != nil || current.Diff.HasChanges || current.ConfigStale || current.LastBackup == nil {
				t.Fatalf("recovery left pending changes or did not create a backup: %+v %v", current.Diff, err)
			}
		})
	}
}

func TestResolveConfigRejectsChangedReviewAndInvalidLocalSyntax(t *testing.T) {
	const malformed = "UnknownOption yes\n"
	a := externalRecoveryFixture(t, malformed)
	service := (*PanelConfig)(a)
	overview, err := service.GetOverview()
	if err != nil || overview.CanUseLocal {
		t.Fatalf("invalid local side can be adopted: %v", err)
	}
	if err := service.ResolveConfigDrift(overview.Revision, overview.ConfigHash, "local"); err == nil || !strings.Contains(err.Error(), "修正本机文件") {
		t.Fatalf("accepted malformed SSH syntax: %v", err)
	}
	root, _ := sshConfigPath()
	if err := os.WriteFile(root, []byte(malformed+"# changed after review\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := service.ResolveConfigDrift(overview.Revision, overview.ConfigHash, "app"); err == nil || !strings.Contains(err.Error(), "已变化") {
		t.Fatalf("modified a newer disk config: %v", err)
	}
	updated, err := service.GetOverview()
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ResolveConfigDrift(updated.Revision, updated.ConfigHash, "app"); err != nil {
		t.Fatalf("valid application record could not repair local syntax: %v", err)
	}
}

func TestRestoreInvalidApplicationRecordRollsBackDisk(t *testing.T) {
	const local = "Host build\n    HostName build.example\n    User root\n"
	a := externalRecoveryFixture(t, local)
	state, _ := a.panelStore.GetHost("gateway")
	if err := a.panelStore.Update(func(next *panelstore.State) error {
		const invalid = "UnknownOption yes\n"
		next.ConfigStale = false
		next.LastError = ""
		next.ConfigLayout.Files[0].Content = invalid
		next.ConfigLayout.Files[0].SHA256 = panelstore.SHA256([]byte(invalid))
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	service := (*PanelConfig)(a)
	overview, err := service.GetOverview()
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ResolveConfigDrift(overview.Revision, overview.ConfigHash, "app"); err == nil || !strings.Contains(err.Error(), "已回滚") {
		t.Fatalf("invalid application snapshot was not rolled back: %v", err)
	}
	root, _ := sshConfigPath()
	content, err := os.ReadFile(root)
	host, exists := a.panelStore.GetHost("gateway")
	if err != nil || string(content) != local || !exists || host.Note != state.Note || a.panelStore.Snapshot().Revision != overview.Revision {
		t.Fatal("a failed recovery changed reviewed data")
	}
}
