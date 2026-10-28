package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/sshd"
)

func externalRecoveryFixture(t *testing.T, external string) *App {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.MkdirAll(filepath.Join(home, ".ssh"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".ssh", "config"), []byte(external), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := panelstore.NewStoreAt(filepath.Join(home, "panel", "panel.json"))
	if err != nil {
		t.Fatal(err)
	}
	old := "Host gateway\n    HostName gateway.example\n    User root\nHost build\n    HostName build.example\n    User root\n    ProxyJump gateway\n"
	err = store.Replace(panelstore.State{Version: panelstore.CurrentVersion, ConfigStale: true, LastError: "SSH 配置已被外部修改，请先导入差异后再生成", Hosts: []panelstore.PanelHost{{Alias: "gateway", HostName: "gateway.example", User: "root", Port: "22", Note: "keep"}, {Alias: "build", HostName: "build.example", User: "root", Port: "22", ProxyJump: "gateway", Password: "secret"}}, ConfigLayout: panelstore.ConfigLayout{Files: []panelstore.ConfigFile{{Path: "config", Content: old, SHA256: panelstore.SHA256([]byte(old))}}, ManagedHosts: []string{"gateway", "build"}}})
	if err != nil {
		t.Fatal(err)
	}
	return &App{panelStore: store, sshMgr: sshd.NewManager()}
}

func TestDeleteExternallyRemovedHostImportsOtherChanges(t *testing.T) {
	a := externalRecoveryFixture(t, "Host build\n    HostName build.example\n    User root\n")
	if err := (*Hosts)(a).DeleteHost("gateway"); err != nil {
		t.Fatal(err)
	}
	if _, ok := a.panelStore.GetHost("gateway"); ok {
		t.Fatal("gateway remains")
	}
	h, ok := a.panelStore.GetHost("build")
	if !ok || h.ProxyJump != "" || h.Password != "secret" {
		t.Fatalf("build was not safely synchronized: %+v", h)
	}
	b, err := os.ReadFile(filepath.Join(os.Getenv("HOME"), ".ssh", "config"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "ProxyJump") || strings.Contains(string(b), "Host gateway") {
		t.Fatalf("old configuration resurrected: %s", b)
	}
}

func TestDeleteExternalRemovalDoesNotAcceptOtherConflicts(t *testing.T) {
	a := externalRecoveryFixture(t, "Host build\n    HostName build.example\n    User root\nMatch host *.example\n    SetEnv TEST=value\n")
	if err := (*Hosts)(a).DeleteHost("gateway"); err == nil {
		t.Fatal("unrelated Match conflict was accepted")
	}
	if _, ok := a.panelStore.GetHost("gateway"); !ok {
		t.Fatal("gateway was deleted despite unrelated conflict")
	}
}

func TestWatcherRetriesAfterExternalDriftWasMarkedStale(t *testing.T) {
	a := externalRecoveryFixture(t, "Host gateway\n    HostName gateway.example\n    User root\nHost build\n    HostName build.example\n    User root\n")
	a.pollPanelConfig()
	h, _ := a.panelStore.GetHost("build")
	if h.ProxyJump != "" || a.panelStore.Snapshot().ConfigStale {
		t.Fatal("non-conflicting external change remained stale")
	}
}

func TestWatcherImportsChangedHostWhileMissingHostNeedsReview(t *testing.T) {
	a := externalRecoveryFixture(t, "Host build\n    HostName build.example\n    User root\n")
	a.pollPanelConfig()
	build, _ := a.panelStore.GetHost("build")
	if build.ProxyJump != "" || build.Password != "secret" {
		t.Fatal("build connection was not synchronized while preserving its password")
	}
	if _, ok := a.panelStore.GetHost("gateway"); !ok {
		t.Fatal("gateway metadata was removed without confirmation")
	}
	diff, err := a.comparePanelConfigLocked()
	if err != nil || len(diff.Conflicts) == 0 {
		t.Fatal("missing gateway conflict must remain visible")
	}
}

func TestWatcherDoesNotImportChangesWithOtherConflicts(t *testing.T) {
	a := externalRecoveryFixture(t, "Host build\n    HostName build.example\n    User root\nMatch host *.example\n    SetEnv TEST=value\n")
	a.pollPanelConfig()
	build, _ := a.panelStore.GetHost("build")
	if build.ProxyJump != "gateway" {
		t.Fatal("ambiguous config was imported")
	}
}
