package panelsync

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"diteng-pannel/internal/panelstore"
)

func TestReadTreeImportAndGenerateGroups(t *testing.T) {
	sshDir := t.TempDir()
	root := filepath.Join(sshDir, "config")
	groupDir := filepath.Join(sshDir, "config.d")
	if err := os.MkdirAll(groupDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root, []byte("Host *\n    ServerAliveInterval 30\nInclude ~/.ssh/config.d/*\n\nHost local\n    HostName 127.0.0.1\n    User me\n"), 0600); err != nil {
		t.Fatal(err)
	}
	// Includes using the real home are intentionally not followed in this
	// fixture; add a relative include to exercise tree loading deterministically.
	if err := os.WriteFile(root, []byte("Host *\n    ServerAliveInterval 30\nInclude config.d/*.conf\n\nHost local\n    HostName 127.0.0.1\n    User me\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(groupDir, "01-prod.conf"), []byte("Host prod\n    HostName 10.0.0.5\n    User root\n    IdentityFile ~/.ssh/id_ed25519\n"), 0600); err != nil {
		t.Fatal(err)
	}

	files, err := ReadTree(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 {
		t.Fatalf("files=%d, want 2", len(files))
	}
	result, err := Import(context.Background(), root, panelstore.State{Version: panelstore.CurrentVersion})
	if err != nil {
		t.Fatal(err)
	}
	if result.NeedsReview {
		t.Fatalf("unexpected conflicts: %#v", result.Diff.Conflicts)
	}
	if len(result.State.Hosts) != 2 {
		t.Fatalf("hosts=%d, want 2", len(result.State.Hosts))
	}
	for _, h := range result.State.Hosts {
		if h.Alias == "prod" && h.GroupID != "01-prod" {
			t.Fatalf("prod group=%q, want prod", h.GroupID)
		}
	}

	rendered, err := Generate(panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts: []panelstore.PanelHost{
			{Alias: "local", HostName: "127.0.0.1", User: "me"},
			{Alias: "prod", HostName: "10.0.0.5", User: "root", GroupID: "01-prod", Password: "do-not-render"},
		},
		Groups: []panelstore.PanelGroup{{ID: "01-prod", Name: "01-prod"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rendered.Files) != 2 {
		t.Fatalf("generated files=%d, want 2", len(rendered.Files))
	}
	for _, f := range rendered.Files {
		if strings.Contains(f.Content, "do-not-render") {
			t.Fatalf("password leaked to %s", f.Path)
		}
	}
}

func TestCompareKeepsPasswordOnConfigEdit(t *testing.T) {
	root := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(root, []byte("Host prod\n    HostName 10.0.0.2\n    User root\n"), 0600); err != nil {
		t.Fatal(err)
	}
	state := panelstore.State{
		Version:      panelstore.CurrentVersion,
		Hosts:        []panelstore.PanelHost{{Alias: "prod", HostName: "10.0.0.1", User: "root", Password: "secret"}},
		ConfigLayout: panelstore.ConfigLayout{Files: []panelstore.ConfigFile{{Path: "config", Content: "Host prod\n    HostName 10.0.0.1\n    User root\n", SHA256: panelstore.SHA256([]byte("Host prod\n    HostName 10.0.0.1\n    User root\n"))}}},
	}
	diff, err := Compare(context.Background(), root, state)
	if err != nil {
		t.Fatal(err)
	}
	if diff.Imported == nil || diff.Imported.Hosts[0].Password != "secret" {
		t.Fatalf("password was not preserved: %#v", diff.Imported)
	}
}

func TestCompareTreatsNilAndEmptyHostSlicesAsSame(t *testing.T) {
	root := filepath.Join(t.TempDir(), "config")
	content := "Host prod\n    HostName 10.0.0.2\n    User root\n"
	if err := os.WriteFile(root, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts: []panelstore.PanelHost{{
			Alias: "prod", HostName: "10.0.0.2", User: "root", Port: "22",
			IdentityFiles: nil, ExtraOptions: nil,
		}},
		ConfigLayout: panelstore.ConfigLayout{Files: []panelstore.ConfigFile{{
			Path: "config", Content: content, SHA256: panelstore.SHA256([]byte(content)),
		}}},
	}
	diff, err := Compare(context.Background(), root, state)
	if err != nil {
		t.Fatal(err)
	}
	if diff.HasChanges() {
		t.Fatalf("nil and empty slices caused config drift: %#v", diff)
	}
}

func TestCompareIgnoresExactGeneratedPathRelocation(t *testing.T) {
	rootDir := t.TempDir()
	root := filepath.Join(rootDir, "config")
	if err := os.MkdirAll(filepath.Join(rootDir, "config.d"), 0700); err != nil {
		t.Fatal(err)
	}
	content := "# 1PANNEL-GENERATED\nHost prod\n    HostName 10.0.0.2\n    User root\n"
	if err := os.WriteFile(root, []byte("Include config.d/*\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rootDir, "config.d", "03-zhetai-main.conf"), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts:   []panelstore.PanelHost{{Alias: "prod", HostName: "10.0.0.2", User: "root", Port: "22", GroupID: "03-zhetai"}},
		Groups:  []panelstore.PanelGroup{{ID: "03-zhetai", Name: "03-zhetai"}},
		ConfigLayout: panelstore.ConfigLayout{
			Files: []panelstore.ConfigFile{
				{Path: "config", Content: "Include config.d/*\n", SHA256: panelstore.SHA256([]byte("Include config.d/*\n"))},
				{Path: "config.d/03-zhetai.conf", Content: content, SHA256: panelstore.SHA256([]byte(content))},
			},
			GeneratedFiles: []string{"config", "config.d/03-zhetai-main.conf"},
		},
	}

	diff, err := Compare(context.Background(), root, state)
	if err != nil {
		t.Fatal(err)
	}
	if diff.HasChanges() {
		t.Fatalf("exact generated path relocation was reported as drift: %#v", diff)
	}
	if diff.Imported == nil || len(diff.Imported.Hosts) != 1 || diff.Imported.Hosts[0].GroupID != "03-zhetai" {
		t.Fatalf("relocated file was imported under the wrong group: %#v", diff.Imported)
	}
}

func TestCompareFlagsSensitiveHostDeletionAndChangedMatchForReview(t *testing.T) {
	root := filepath.Join(t.TempDir(), "config")
	content := "Match host *.example\n    SetEnv PANEL=external\n"
	if err := os.WriteFile(root, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts:   []panelstore.PanelHost{{Alias: "prod", HostName: "10.0.0.1", Password: "secret", Note: "keep", GroupID: "01-prod"}},
		Groups:  []panelstore.PanelGroup{{ID: "01-prod", Name: "01-prod"}},
		ConfigLayout: panelstore.ConfigLayout{Files: []panelstore.ConfigFile{{
			Path: "config", Content: "Host prod\n    HostName 10.0.0.1\n", SHA256: panelstore.SHA256([]byte("Host prod\n    HostName 10.0.0.1\n")),
		}}},
	}
	diff, err := Compare(context.Background(), root, state)
	if err != nil {
		t.Fatal(err)
	}
	if !diff.HasChanges() || len(diff.RemovedHosts) != 1 || len(diff.Conflicts) == 0 {
		t.Fatalf("expected deletion/match review, got %#v", diff)
	}
	if !strings.Contains(strings.Join(diff.Conflicts, "\n"), "Match") {
		t.Fatalf("expected Match conflict, got %#v", diff.Conflicts)
	}
}

func TestWriteBacksUpRawTreeAndReplacesGeneratedFiles(t *testing.T) {
	rootDir := t.TempDir()
	sshDir := filepath.Join(rootDir, ".ssh")
	if err := os.MkdirAll(filepath.Join(sshDir, "config.d"), 0700); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(sshDir, "config")
	if err := os.WriteFile(root, []byte("Include config.d/*\n\n# keep me\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sshDir, "config.d", "old.conf"), []byte("Host old\n    HostName old.example\n"), 0600); err != nil {
		t.Fatal(err)
	}

	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts:   []panelstore.PanelHost{{Alias: "prod", HostName: "10.0.0.8", User: "root", Password: "s3cret"}},
	}
	generation := GenerationResult{
		Files: []ConfigFile{
			{Path: "config", Content: "Include config.d/*\n\n# keep me\n", Mode: 0600},
			{Path: "config.d/prod.conf", Content: "# generated\nHost prod\n    HostName 10.0.0.8\n", Mode: 0600},
		},
		RemovedFiles: []string{"config.d/old.conf"},
	}
	written, err := Write(root, filepath.Join(rootDir, "backups"), state, generation)
	if err != nil {
		t.Fatal(err)
	}
	if written.BackupPath == "" {
		t.Fatal("expected backup path")
	}
	if _, err := os.Stat(filepath.Join(sshDir, "config.d", "old.conf")); !os.IsNotExist(err) {
		t.Fatalf("old generated file still exists: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(sshDir, "config.d", "prod.conf"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "s3cret") {
		t.Fatal("password leaked into generated config")
	}
	backupState, err := os.ReadFile(filepath.Join(written.BackupPath, "panel.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(backupState), "s3cret") {
		t.Fatal("backup did not retain Panel password")
	}
}

func TestGenerateRemovesRenamedManagedHostFromGeneratedTail(t *testing.T) {
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts:   []panelstore.PanelHost{{Alias: "new", HostName: "10.0.0.9", User: "root"}},
		ConfigLayout: panelstore.ConfigLayout{
			ManagedHosts: []string{"old"},
			Files:        []panelstore.ConfigFile{{Path: "config", Content: "# keep me\n# 1PANNEL-GENERATED\nHost old\n    HostName 10.0.0.8\n"}},
		},
	}
	generation, err := Generate(state)
	if err != nil {
		t.Fatal(err)
	}
	if len(generation.Files) != 1 {
		t.Fatalf("files=%d, want 1", len(generation.Files))
	}
	content := generation.Files[0].Content
	if strings.Contains(content, "Host old") || !strings.Contains(content, "Host new") || !strings.Contains(content, "keep me") {
		t.Fatalf("generated content did not replace managed tail: %q", content)
	}
}

func TestGenerateRenamedGroupedHostReplacesOldAliasInGroupFile(t *testing.T) {
	groupFile := "config.d/01-cdcp-main.conf"
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Groups:  []panelstore.PanelGroup{{ID: "01-cdcp-main", Name: "01-cdcp-main"}},
		Hosts: []panelstore.PanelHost{
			{Alias: "cdcp-gray", HostName: "198.51.100.70", User: "root", GroupID: "01-cdcp-main", IdentityFiles: []string{"~/.ssh/id_ed25519"}},
			{Alias: "cdcp-main", HostName: "10.0.0.1", User: "root", GroupID: "01-cdcp-main"},
		},
		ConfigLayout: panelstore.ConfigLayout{
			ManagedHosts: []string{"cdcp-beta", "cdcp-main"},
			Files: []panelstore.ConfigFile{
				{Path: "config", Content: "Include ~/.ssh/config.d/*\n"},
				{Path: groupFile, Content: "Host cdcp-beta\n    HostName 198.51.100.70\n# 1PANNEL-GENERATED\nHost cdcp-beta\n    HostName 198.51.100.70\nHost cdcp-main\n    HostName 10.0.0.1\n"},
			},
		},
	}
	generation, err := Generate(state)
	if err != nil {
		t.Fatal(err)
	}
	var content string
	for _, file := range generation.Files {
		if file.Path == groupFile {
			content = file.Content
		}
	}
	if content == "" {
		t.Fatalf("group file %s not generated", groupFile)
	}
	if strings.Contains(content, "Host cdcp-beta") {
		t.Fatalf("old alias still present: %q", content)
	}
	if strings.Count(content, "Host cdcp-gray") != 1 || strings.Count(content, "Host cdcp-main") != 1 {
		t.Fatalf("unexpected host blocks: %q", content)
	}
}

func TestGenerateIsIdempotentAndDoesNotAccumulateBlankLines(t *testing.T) {
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts: []panelstore.PanelHost{
			{Alias: "prod", HostName: "10.0.0.8", User: "root"},
			{Alias: "backup", HostName: "10.0.0.9", User: "root"},
			{Alias: "app", HostName: "10.0.0.10", User: "root", GroupID: "apps"},
			{Alias: "worker", HostName: "10.0.0.11", User: "root", GroupID: "apps"},
		},
		Groups: []panelstore.PanelGroup{{ID: "apps", Name: "apps"}},
		ConfigLayout: panelstore.ConfigLayout{Files: []panelstore.ConfigFile{
			{Path: "config", Content: "\n\n\n# 1PANNEL-GENERATED\nHost old\n    HostName 10.0.0.7\n\n"},
			{Path: "config.d/apps.conf", Content: "# 1PANNEL-GENERATED\nHost old-app\n    HostName 10.0.0.6\n\n"},
		}},
	}

	first, err := Generate(state)
	if err != nil {
		t.Fatal(err)
	}
	state.ConfigLayout.Files = nil
	for _, file := range first.Files {
		state.ConfigLayout.Files = append(state.ConfigLayout.Files, panelstore.ConfigFile{
			Path: file.Path, Content: file.Content,
		})
	}
	second, err := Generate(state)
	if err != nil {
		t.Fatal(err)
	}

	if len(first.Files) != 2 || len(second.Files) != 2 {
		t.Fatalf("generated files: first=%d, second=%d, want 2 each", len(first.Files), len(second.Files))
	}
	for i, file := range first.Files {
		if file.Content != second.Files[i].Content {
			t.Fatalf("%s generation is not idempotent:\nfirst:\n%q\nsecond:\n%q", file.Path, file.Content, second.Files[i].Content)
		}
		if strings.HasPrefix(file.Content, "\n") {
			t.Fatalf("%s keeps a leading blank line: %q", file.Path, file.Content)
		}
		if !strings.HasSuffix(file.Content, "\n") || strings.HasSuffix(file.Content, "\n\n") {
			t.Fatalf("%s must end with exactly one newline: %q", file.Path, file.Content)
		}
		if strings.Count(file.Content, "\n\nHost ") != 1 || len(parseHosts(file.Content)) != 2 {
			t.Fatalf("%s must keep one blank line between its two hosts: %q", file.Path, file.Content)
		}
	}
}

func TestPortForwardRoundTrip(t *testing.T) {
	state := panelstore.State{
		Version: panelstore.CurrentVersion,
		Hosts: []panelstore.PanelHost{{
			Alias: "db", HostName: "10.0.0.8", User: "root",
			PortForwards: []panelstore.PortForward{
				{Kind: "localforward", Bind: "127.0.0.1", Port: "15432", Target: "10.0.0.8", TargetPort: "5432"},
				{Kind: "dynamicforward", Port: "1080"},
			},
		}},
	}
	generation, err := Generate(state)
	if err != nil {
		t.Fatal(err)
	}
	content := generation.Files[0].Content
	if !strings.Contains(content, "LocalForward 127.0.0.1:15432 10.0.0.8:5432") ||
		!strings.Contains(content, "DynamicForward 1080") {
		t.Fatalf("port forwarding was not rendered: %q", content)
	}
	parsed := parseHosts(content)
	if len(parsed) != 1 || len(parsed[0].PortForwards) != 2 {
		t.Fatalf("port forwarding was not parsed back: %#v", parsed)
	}
}
