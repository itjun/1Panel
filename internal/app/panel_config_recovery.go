package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
)

// ResolveConfigDrift reconciles the configuration the user reviewed. A new
// change on either side requires a new review before overwriting anything.
func (s *PanelConfig) ResolveConfigDrift(revision uint64, configHash, source string) error {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	state := a.panelStore.Snapshot()
	root, err := sshConfigPath()
	if err != nil {
		return err
	}
	files, err := panelsync.ReadTree(root)
	if err != nil {
		return err
	}
	if revision != state.Revision || configHash != configFilesHash(files) {
		return fmt.Errorf("应用记录或本机配置已变化，请刷新后重新检查差异")
	}
	backupRoot := filepath.Join(filepath.Dir(a.panelStore.Path()), "backups")
	switch source {
	case "local":
		diff, err := panelsync.CompareTree(context.Background(), root, state, files)
		if err != nil {
			return err
		}
		if reason := localConfigBlocker(a.publicConfigConflicts(diff.Conflicts, state, state, files)); reason != "" {
			return fmt.Errorf("请修正本机文件后刷新：%s", reason)
		}
		if !diff.HasChanges() && !state.ConfigStale {
			return nil
		}
		if _, err := panelsync.CreateBackup(backupRoot, root, state, files); err != nil {
			return err
		}
		if err := panelsync.PruneBackups(backupRoot, 50); err != nil {
			return err
		}
		latest, err := panelsync.ReadTree(root)
		if err != nil {
			return err
		}
		if configFilesHash(latest) != configHash {
			return fmt.Errorf("本机 SSH 配置已变化，请刷新后重新检查差异")
		}
		next := *diff.Imported
		next.ConfigStale = false
		next.LastError = ""
		if err := a.panelStore.Replace(next); err != nil {
			return err
		}
		a.invalidateChangedPanelConnections(state, next)
		for _, alias := range diff.RemovedHosts {
			if a.sshMgr != nil {
				a.sshMgr.Close(alias)
			}
			if a.agentPool != nil {
				a.agentPool.InvalidateStatus(alias)
			}
		}
		a.emitPanelConfigEvent("panel-config-imported", nil)
		return a.syncLegacyGroupsFromPanel(next)
	case "app":
		if err := a.restoreExpectedPanelConfig(root, backupRoot, state, files); err != nil {
			return err
		}
		a.emitPanelConfigEvent("panel-config-imported", nil)
		return nil
	default:
		return fmt.Errorf("未知的 SSH 配置处理方式")
	}
}

func localConfigBlocker(conflicts []PanelConfigConflict) string {
	for _, conflict := range conflicts {
		if conflict.Kind != "host-removed" && conflict.Kind != "file" {
			return conflict.Summary
		}
	}
	return ""
}

func expectedPanelConfig(state panelstore.State) (panelstore.State, error) {
	if !state.ConfigStale {
		return state, nil
	}
	generation, err := panelsync.Generate(state)
	if err != nil {
		return panelstore.State{}, fmt.Errorf("生成 SSH 差异失败: %w", err)
	}
	expected := make(map[string]panelstore.ConfigFile, len(state.ConfigLayout.Files))
	for _, file := range state.ConfigLayout.Files {
		expected[file.Path] = file
	}
	state.ConfigLayout.GeneratedFiles = nil
	for _, file := range generation.Files {
		expected[file.Path] = panelstore.ConfigFile{Path: file.Path, Content: file.Content, Mode: file.Mode, SHA256: file.SHA256}
		state.ConfigLayout.GeneratedFiles = append(state.ConfigLayout.GeneratedFiles, file.Path)
	}
	for _, path := range generation.RemovedFiles {
		delete(expected, path)
	}
	state.ConfigLayout.Files = make([]panelstore.ConfigFile, 0, len(expected))
	for _, file := range expected {
		state.ConfigLayout.Files = append(state.ConfigLayout.Files, file)
	}
	state.ConfigLayout.ManagedHosts = make([]string, 0, len(state.Hosts))
	for _, host := range state.Hosts {
		state.ConfigLayout.ManagedHosts = append(state.ConfigLayout.ManagedHosts, host.Alias)
	}
	state.ConfigLayout.LastGenerated = generation.GeneratedAt
	return state, nil
}

func (a *App) restoreExpectedPanelConfig(root, backupRoot string, state panelstore.State, files []panelsync.ConfigFile) error {
	next, err := expectedPanelConfig(state)
	if err != nil {
		return err
	}
	diffs := a.makeFileDiff(next, files, panelsync.GenerationResult{})
	if len(diffs) == 0 && !state.ConfigStale {
		return nil
	}
	var changes panelsync.GenerationResult
	for _, diff := range diffs {
		if !safeConfigRelative(diff.Path) {
			return fmt.Errorf("请在本机修正 SSH 目录以外的配置文件 %s，再刷新", diff.Path)
		}
		if diff.Kind == "added" {
			changes.RemovedFiles = append(changes.RemovedFiles, diff.Path)
			continue
		}
		file, _ := panelFile(next.ConfigLayout.Files, diff.Path)
		if diff.Kind == "removed" {
			// A changed Include can make an existing file disappear from the
			// diff. Do not overwrite that unreviewed file when restoring it.
			target := filepath.Join(filepath.Dir(root), filepath.FromSlash(diff.Path))
			if info, err := os.Lstat(target); err == nil {
				if info.Mode().IsRegular() {
					content, err := os.ReadFile(target)
					if err == nil && string(content) == file.Content {
						continue
					}
				}
				return fmt.Errorf("%s 仍在磁盘上，但未被当前 SSH 配置引用。请先检查此文件再刷新", diff.Path)
			} else if !os.IsNotExist(err) {
				return err
			}
		}
		changes.Files = append(changes.Files, panelsync.ConfigFile{Path: file.Path, Content: file.Content, Mode: file.Mode, SHA256: file.SHA256})
	}
	_, err = panelsync.WriteVerified(root, backupRoot, state, changes, files, func() error {
		written, err := panelsync.ReadTree(root)
		if err != nil {
			return err
		}
		if len(a.makeFileDiff(next, written, panelsync.GenerationResult{})) != 0 {
			return fmt.Errorf("恢复后的 SSH 文件与应用记录不一致，请检查本机 Include 配置")
		}
		diff, err := panelsync.CompareTree(context.Background(), root, next, written)
		if err != nil {
			return err
		}
		if len(diff.Conflicts) > 0 {
			return fmt.Errorf("无法恢复应用记录：%s", strings.Join(diff.Conflicts, "；"))
		}
		next.ConfigLayout.Files = diff.Imported.ConfigLayout.Files
		next.ConfigStale = false
		next.LastError = ""
		return a.panelStore.Replace(next)
	})
	return err
}
