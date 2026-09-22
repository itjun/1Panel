package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"diteng-pannel/internal/groupid"
	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
)

// bootstrapPanelState migrates the old split model (ssh-config + groups.json
// + host_meta.json) into panel.json. Existing config files are only read here;
// generation remains an explicit Panel operation so startup cannot unexpectedly
// rewrite a user's SSH configuration.
func (a *App) bootstrapPanelState() error {
	if a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	state := a.panelStore.Snapshot()
	// Panel JSON is the runtime source of truth. A previous Panel mutation may
	// have been persisted before SSH generation completed; importing or
	// migrating the old config tree here would resurrect stale group IDs and
	// move hosts back to the pre-edit group. Keep the JSON model and expose
	// config-stale to the UI until the user explicitly imports or regenerates
	// the config.
	if !shouldImportPanelConfigAtStartup(state) {
		return a.syncLegacyGroupsFromPanel(state)
	}
	configPath, err := sshconfig.ConfigPath()
	if err != nil {
		return err
	}
	if err := a.migrateLegacyGroupConfigFiles(configPath); err != nil {
		return err
	}
	_, statErr := os.Stat(a.panelStore.Path())
	panelExists := statErr == nil
	legacyMigration := !panelExists || (state.Revision == 0 && len(state.Hosts) == 0)
	state, repairedGroups := recoverPanelGroupMetadata(a.panelStore.Path(), state)

	imported, err := panelsync.Import(context.Background(), configPath, state)
	if err != nil {
		return err
	}
	if imported.NeedsReview {
		// Keep the last known-good JSON. The config editor can expose the
		// conflicts through the explicit import flow later.
		return fmt.Errorf("SSH 配置存在冲突，需要导入确认: %s", strings.Join(imported.Diff.Conflicts, "; "))
	}

	next := imported.State
	// A failed generation can leave a stale flag behind even when the formal
	// config has since returned to the recorded snapshot. Do not force the user
	// to import an unchanged config before ordinary Panel operations resume.
	next.ConfigStale = false
	next.LastError = ""
	if legacyMigration && a.hostMeta != nil {
		for i := range next.Hosts {
			next.Hosts[i].Password = a.hostMeta.GetPassword(next.Hosts[i].Alias)
			next.Hosts[i].Note = a.hostMeta.GetNote(next.Hosts[i].Alias)
		}
	}
	if legacyMigration && a.groups != nil {
		legacyGroups := a.groups.List()
		for _, g := range legacyGroups {
			groupID := strings.TrimSpace(g.Name)
			if groupID == "" {
				groupID = strings.TrimSpace(g.ID)
			}
			if err := groupid.Validate(groupID); err != nil {
				return fmt.Errorf("迁移旧分组 %s 失败: %w", g.ID, err)
			}
			if !containsPanelGroup(next.Groups, groupID) {
				next.Groups = append(next.Groups, panelstore.PanelGroup{
					ID: groupID, Name: groupID, ParentID: g.ParentID,
					BoardTitle: g.BoardTitle, Order: g.Order,
				})
			}
			for i := range next.Hosts {
				if next.Hosts[i].GroupID == "" && containsString(g.Hosts, next.Hosts[i].Alias) {
					next.Hosts[i].GroupID = groupID
				}
			}
		}
	}
	if len(next.ConfigLayout.ManagedHosts) == 0 && len(next.Hosts) > 0 {
		next.ConfigLayout.ManagedHosts = make([]string, 0, len(next.Hosts))
		for _, host := range next.Hosts {
			next.ConfigLayout.ManagedHosts = append(next.ConfigLayout.ManagedHosts, host.Alias)
		}
	}

	if repairedGroups {
		// Keep the pre-repair state recoverable before replacing it with the
		// metadata-restored model.
		if err := a.backupPanelStateLocked(); err != nil {
			return err
		}
	}
	if shouldPersistPanelBootstrap(state, next, panelExists, imported.Diff.HasChanges(), repairedGroups) {
		if err := a.panelStore.Replace(next); err != nil {
			return err
		}
	}
	return a.syncLegacyGroupsFromPanel(a.panelStore.Snapshot())
}

// migrateLegacyGroupConfigFiles keeps startup compatible with data created
// before Group ID became the group name. PanelStore migrates the JSON paths;
// this companion step moves the matching generated files before the config
// tree is parsed, so an old config.d/<opaque-id>.conf cannot be re-imported as
// a second invalid group. Only the application-owned config.d directory is
// touched and a pre-existing destination is never overwritten.
func (a *App) migrateLegacyGroupConfigFiles(configPath string) error {
	if a == nil || a.groups == nil {
		return nil
	}
	configDir := filepath.Join(filepath.Dir(configPath), "config.d")
	for _, group := range a.groups.List() {
		oldID := strings.TrimSpace(group.ID)
		name := strings.TrimSpace(group.Name)
		if oldID == "" || name == "" || oldID == name {
			continue
		}
		if err := groupid.Validate(name); err != nil {
			return fmt.Errorf("旧分组 %s 无法迁移为 %s: %w", oldID, name, err)
		}
		if filepath.Base(oldID) != oldID || strings.ContainsAny(oldID, `/\\`) {
			return fmt.Errorf("旧分组 ID 包含非法路径字符，无法迁移: %s", oldID)
		}
		oldPath := filepath.Join(configDir, oldID+".conf")
		newPath := filepath.Join(configDir, name+".conf")
		_, oldErr := os.Stat(oldPath)
		if os.IsNotExist(oldErr) {
			continue
		}
		if oldErr != nil {
			return fmt.Errorf("检查旧分组配置文件失败: %w", oldErr)
		}
		if _, err := os.Stat(newPath); err == nil {
			return fmt.Errorf("旧分组配置文件与新文件同时存在，需要人工确认: %s", newPath)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("检查新分组配置文件失败: %w", err)
		}
		if err := os.Rename(oldPath, newPath); err != nil {
			return fmt.Errorf("迁移分组配置文件 %s 失败: %w", oldID, err)
		}
	}
	return nil
}

func shouldPersistPanelBootstrap(before, after panelstore.State, panelExists, importedChanged, repairedGroups bool) bool {
	return repairedGroups || !panelExists || importedChanged ||
		(len(before.Hosts) == 0 && len(after.Hosts) > 0) ||
		before.ConfigStale != after.ConfigStale || before.LastError != after.LastError
}

func shouldImportPanelConfigAtStartup(state panelstore.State) bool {
	return !state.ConfigStale
}

// recoverPanelGroupMetadata repairs a migration failure mode where an
// external config import rebuilt connection fields but dropped Panel-only
// group assignments. The write adapter backs up each pre-change state, so use
// the private snapshot with the most matching aliases and the largest number
// of assignments. Current connection fields and credentials always win.
func recoverPanelGroupMetadata(panelPath string, current panelstore.State) (panelstore.State, bool) {
	if !current.ConfigStale || !strings.Contains(current.LastError, "SSH 配置已被外部修改") {
		return current, false
	}
	currentAssignments := countPanelAssignments(current)
	currentAliases := make(map[string]struct{}, len(current.Hosts))
	for _, host := range current.Hosts {
		currentAliases[host.Alias] = struct{}{}
	}
	if len(currentAliases) == 0 {
		return current, false
	}

	backupRoot := filepath.Join(filepath.Dir(panelPath), "backups")
	entries, err := os.ReadDir(backupRoot)
	if err != nil {
		return current, false
	}
	type candidate struct {
		state     panelstore.State
		matching  int
		assigned  int
		entryName string
	}
	var best candidate
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		backup, err := panelstore.LoadStateFile(filepath.Join(backupRoot, entry.Name(), "panel.json"))
		if err != nil {
			continue
		}
		matching := 0
		for _, host := range backup.Hosts {
			if _, ok := currentAliases[host.Alias]; ok {
				matching++
			}
		}
		assigned := countPanelAssignments(backup)
		if matching < len(currentAliases) || assigned <= currentAssignments {
			continue
		}
		if matching > best.matching || (matching == best.matching && assigned > best.assigned) ||
			(matching == best.matching && assigned == best.assigned && entry.Name() > best.entryName) {
			best = candidate{state: backup, matching: matching, assigned: assigned, entryName: entry.Name()}
		}
	}
	if best.assigned <= currentAssignments {
		return current, false
	}

	groupIDs := make(map[string]struct{}, len(current.Groups))
	for _, group := range current.Groups {
		groupIDs[group.ID] = struct{}{}
	}
	for _, group := range best.state.Groups {
		if _, ok := groupIDs[group.ID]; ok {
			continue
		}
		current.Groups = append(current.Groups, group)
		groupIDs[group.ID] = struct{}{}
	}
	backupHosts := make(map[string]panelstore.PanelHost, len(best.state.Hosts))
	for _, host := range best.state.Hosts {
		backupHosts[host.Alias] = host
	}
	changed := false
	for i := range current.Hosts {
		backup, ok := backupHosts[current.Hosts[i].Alias]
		if !ok || backup.GroupID == "" {
			continue
		}
		if current.Hosts[i].GroupID != backup.GroupID || current.Hosts[i].Order != backup.Order {
			current.Hosts[i].GroupID = backup.GroupID
			current.Hosts[i].Order = backup.Order
			changed = true
		}
	}
	if !changed {
		return current, false
	}
	return current, true
}

func countPanelAssignments(state panelstore.State) int {
	count := 0
	for _, host := range state.Hosts {
		if host.GroupID != "" {
			count++
		}
	}
	return count
}

// syncLegacyGroupsFromPanel keeps the old groups.json store as a compatibility
// cache for existing UI methods. Panel JSON remains authoritative; this copy is
// refreshed after startup/import so external config groups are visible without
// making groups.json a second source of truth.
func (a *App) syncLegacyGroupsFromPanel(state panelstore.State) error {
	if a == nil || a.groups == nil {
		return nil
	}
	desired := panelGroupsAsLegacy(state)
	desiredByID := make(map[string]bool, len(desired))
	for _, group := range desired {
		desiredByID[group.ID] = true
	}
	for _, existing := range a.groups.List() {
		if !desiredByID[existing.ID] {
			_ = a.groups.Delete(existing.ID)
		}
	}
	for _, group := range desired {
		if err := a.groups.Upsert(group); err != nil {
			return fmt.Errorf("同步兼容分组 %s 失败: %w", group.ID, err)
		}
	}
	return nil
}

func panelGroupsAsLegacy(state panelstore.State) []groups.Group {
	hostsByGroup := make(map[string][]panelstore.PanelHost)
	for _, host := range state.Hosts {
		if host.GroupID != "" {
			hostsByGroup[host.GroupID] = append(hostsByGroup[host.GroupID], host)
		}
	}
	for id := range hostsByGroup {
		sort.SliceStable(hostsByGroup[id], func(i, j int) bool {
			if hostsByGroup[id][i].Order != hostsByGroup[id][j].Order {
				return hostsByGroup[id][i].Order < hostsByGroup[id][j].Order
			}
			return hostsByGroup[id][i].Alias < hostsByGroup[id][j].Alias
		})
	}
	out := make([]groups.Group, 0, len(state.Groups))
	for _, group := range state.Groups {
		members := make([]string, 0, len(hostsByGroup[group.ID]))
		for _, host := range hostsByGroup[group.ID] {
			members = append(members, host.Alias)
		}
		out = append(out, groups.Group{
			ID: group.ID, Name: group.Name, ParentID: group.ParentID,
			BoardTitle: group.BoardTitle, Order: group.Order, Hosts: members,
		})
	}
	return out
}

func containsPanelGroup(groups []panelstore.PanelGroup, id string) bool {
	for _, g := range groups {
		if g.ID == id {
			return true
		}
	}
	return false
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

// connectOptionFor is the runtime seam for Go-backed features. It reads the
// Panel model first and only falls back to the legacy parser while migrating a
// pre-panel installation.
func (a *App) connectOptionFor(host string) (sshd.ConnectOption, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return sshd.ConnectOption{}, fmt.Errorf("主机名不能为空")
	}
	if a != nil && a.panelStore != nil {
		if h, ok := a.panelStore.GetHost(host); ok {
			identity := ""
			identities := make([]string, 0, len(h.IdentityFiles))
			if len(h.IdentityFiles) > 0 {
				identity = expandTilde(h.IdentityFiles[0])
				for _, file := range h.IdentityFiles {
					identities = append(identities, expandTilde(file))
				}
			}
			return sshd.ConnectOption{
				Host:          h.Alias,
				HostName:      h.HostName,
				User:          h.User,
				Port:          h.Port,
				IdentityFile:  identity,
				IdentityFiles: identities,
				HostKeyAlgos:  h.HostKeyAlgos,
				ProxyJump:     h.ProxyJump,
				ProxyCommand:  h.ProxyCommand,
				IdentityAgent: expandTilde(h.IdentityAgent),
				ForwardAgent:  h.ForwardAgent,
				Password:      h.Password,
			}, nil
		}
	}

	// Compatibility path for startup before panel.json has been migrated.
	hosts, err := sshconfig.Parse()
	if err != nil {
		return sshd.ConnectOption{}, err
	}
	for _, h := range hosts {
		if h.Name == host {
			return sshd.ConnectOption{
				Host:          h.Name,
				HostName:      h.HostName,
				User:          h.User,
				Port:          h.Port,
				IdentityFile:  h.IdentityFile,
				HostKeyAlgos:  h.HostKeyAlgos,
				ProxyJump:     h.ProxyJump,
				ProxyCommand:  h.ProxyCommand,
				IdentityAgent: expandTilde(h.IdentityAgent),
				ForwardAgent:  h.ForwardAgent,
			}, nil
		}
	}
	return sshd.ConnectOption{}, fmt.Errorf("未找到主机: %s", host)
}

func (a *App) panelHostConfigs(includeGit bool) ([]sshconfig.HostConfig, error) {
	if a == nil || a.panelStore == nil {
		return nil, fmt.Errorf("Panel 主机存储未初始化")
	}
	hosts := a.panelStore.ListHosts()
	out := make([]sshconfig.HostConfig, 0, len(hosts))
	for _, h := range hosts {
		cfg := sshconfig.HostConfig{
			Name:          h.Alias,
			HostName:      h.HostName,
			User:          h.User,
			Port:          h.Port,
			ProxyJump:     h.ProxyJump,
			ProxyCommand:  h.ProxyCommand,
			IdentityAgent: expandTilde(h.IdentityAgent),
			ForwardAgent:  h.ForwardAgent,
			HostKeyAlgos:  h.HostKeyAlgos,
			Note:          h.Note,
			Password:      h.Password,
		}
		if len(h.IdentityFiles) > 0 {
			cfg.IdentityFile = expandTilde(h.IdentityFiles[0])
		}
		if !includeGit && sshconfig.IsGitHost(cfg) {
			continue
		}
		out = append(out, cfg)
	}
	return out, nil
}
