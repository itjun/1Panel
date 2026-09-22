package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"diteng-pannel/internal/groupid"
	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/hosticon"
	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
	"diteng-pannel/internal/sshconfig"
)

func (a *App) exportPanelBackup(dir string) (string, error) {
	state := a.panelStore.Snapshot()
	exported := state
	exported.Hosts = make([]panelstore.PanelHost, 0, len(state.Hosts))
	hosts := make([]sshconfig.HostConfig, 0, len(state.Hosts))
	hostSet := make(map[string]bool, len(state.Hosts))
	for _, host := range state.Hosts {
		cfg := panelHostToLegacy(host)
		if sshconfig.IsGitHost(cfg) {
			continue
		}
		// External export is intentionally redacted. Local automatic backups
		// created by panelsync keep the original Panel JSON privately.
		host.Password = ""
		exported.Hosts = append(exported.Hosts, host)
		legacy := panelHostToLegacy(host)
		legacy.Password = ""
		hosts = append(hosts, legacy)
		hostSet[host.Alias] = true
	}

	groupsList := groupsFromPanelState(exported, hostSet)
	var icons []hosticon.Record
	if a.hostIcons != nil {
		for _, record := range a.hostIcons.List() {
			if hostSet[record.Host] {
				icons = append(icons, record)
			}
		}
	}
	configPath, err := sshConfigPath()
	if err != nil {
		return "", err
	}
	configFiles, err := panelsync.ReadTree(configPath)
	if err != nil {
		return "", err
	}
	now := time.Now()
	data := BackupData{
		Version: backupVersion, ExportedAt: now.Unix(), Hosts: hosts,
		Groups: groupsList, Icons: icons, PanelState: &exported,
		ConfigFiles: configFiles, IncludesPasswords: false,
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("序列化备份失败: %w", err)
	}
	backupDir := filepath.Join(dir, now.Format("2006-01-02"))
	if err := os.MkdirAll(backupDir, 0700); err != nil {
		return "", fmt.Errorf("创建备份文件夹失败: %w", err)
	}
	path := filepath.Join(backupDir, "serverpanel-backup.json")
	if err := os.WriteFile(path, b, 0600); err != nil {
		return "", fmt.Errorf("写入备份文件失败: %w", err)
	}
	return fmt.Sprintf("已导出 %d 台主机、%d 个分组到 %s（密码已脱敏）", len(hosts), len(groupsList), backupDir), nil
}

func (a *App) importPanelBackup(data *BackupData, overwrite bool) (*ImportResult, error) {
	if data == nil || data.PanelState == nil {
		return nil, fmt.Errorf("备份缺少 Panel JSON")
	}
	incomingState := *data.PanelState
	if _, err := panelstore.MigrateLegacyGroupIDs(&incomingState); err != nil {
		return nil, fmt.Errorf("迁移备份分组 ID 失败: %w", err)
	}
	normalizedGroups, err := normalizeBackupGroups(data.Groups)
	if err != nil {
		return nil, err
	}
	data.PanelState = &incomingState
	data.Groups = normalizedGroups
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	if err := a.backupPanelStateLocked(); err != nil {
		return nil, err
	}
	current := a.panelStore.Snapshot()
	next := current
	res := &ImportResult{Added: []string{}, Overwritten: []string{}, Skipped: []string{}}
	for _, incoming := range data.PanelState.Hosts {
		if incoming.Alias == "" || sshconfig.IsGitHost(panelHostToLegacy(incoming)) {
			continue
		}
		index := -1
		for i := range next.Hosts {
			if next.Hosts[i].Alias == incoming.Alias {
				index = i
				break
			}
		}
		if index >= 0 && !overwrite {
			res.Skipped = append(res.Skipped, incoming.Alias)
			continue
		}
		if index >= 0 && !data.IncludesPasswords && incoming.Password == "" {
			incoming.Password = next.Hosts[index].Password
		}
		if index >= 0 {
			next.Hosts[index] = incoming
			res.Overwritten = append(res.Overwritten, incoming.Alias)
		} else {
			next.Hosts = append(next.Hosts, incoming)
			res.Added = append(res.Added, incoming.Alias)
		}
	}
	if len(data.PanelState.Groups) > 0 {
		next.Groups = mergePanelGroups(next.Groups, data.PanelState.Groups)
	}
	if len(data.ConfigFiles) > 0 {
		next.ConfigLayout.Files = make([]panelstore.ConfigFile, 0, len(data.ConfigFiles))
		for _, file := range data.ConfigFiles {
			next.ConfigLayout.Files = append(next.ConfigLayout.Files, panelstore.ConfigFile{
				Path: file.Path, Content: file.Content, Mode: file.Mode, SHA256: file.SHA256,
			})
		}
		next.ConfigLayout.GeneratedFiles = append([]string(nil), data.PanelState.ConfigLayout.GeneratedFiles...)
	}
	next.ConfigStale = true
	next.LastError = ""
	if err := a.panelStore.Replace(next); err != nil {
		return nil, err
	}
	if _, err := a.generatePanelConfigLocked(nil, true); err != nil {
		return nil, err
	}
	for _, alias := range append(append([]string{}, res.Added...), res.Overwritten...) {
		if host, ok := a.panelStore.GetHost(alias); ok {
			if err := sWriteHostMeta(a, host); err != nil {
				return nil, err
			}
		}
	}
	if a.hostIcons != nil {
		for _, record := range data.Icons {
			if record.OSRelease == "" || (!containsStr(res.Added, record.Host) && !containsStr(res.Overwritten, record.Host)) {
				continue
			}
			if err := a.hostIcons.Put(record.Host, record.OSRelease); err != nil {
				return nil, err
			}
			res.Icons++
		}
	}
	if a.groups != nil {
		for _, group := range data.Groups {
			group.Hosts = filterKnownHosts(group.Hosts, hostNameSet(next.Hosts))
			if err := a.groups.Upsert(group); err != nil {
				return nil, fmt.Errorf("恢复分组 %s 失败: %w", group.Name, err)
			}
			res.Groups++
		}
	}
	return res, nil
}

func panelHostToLegacy(host panelstore.PanelHost) sshconfig.HostConfig {
	cfg := sshconfig.HostConfig{
		Name: host.Alias, HostName: host.HostName, User: host.User,
		Port: host.Port, ProxyJump: host.ProxyJump, ProxyCommand: host.ProxyCommand,
		IdentityAgent: host.IdentityAgent, ForwardAgent: host.ForwardAgent,
		HostKeyAlgos: host.HostKeyAlgos,
		Note:         host.Note, Password: host.Password,
	}
	if len(host.IdentityFiles) > 0 {
		cfg.IdentityFile = expandTilde(host.IdentityFiles[0])
	}
	return cfg
}

func legacyBackupPanelState(current panelstore.State, data *BackupData) (*panelstore.State, error) {
	if data == nil {
		return &panelstore.State{Version: panelstore.CurrentVersion}, nil
	}
	normalizedGroups, err := normalizeBackupGroups(data.Groups)
	if err != nil {
		return nil, err
	}
	next := current
	next.Version = panelstore.CurrentVersion
	next.Hosts = make([]panelstore.PanelHost, 0, len(data.Hosts))
	next.Groups = make([]panelstore.PanelGroup, 0, len(normalizedGroups))
	groupByHost := make(map[string]string)
	for index, group := range normalizedGroups {
		id := group.ID
		if id == "" {
			continue
		}
		next.Groups = append(next.Groups, panelstore.PanelGroup{
			ID: id, Name: id, ParentID: group.ParentID,
			BoardTitle: group.BoardTitle, Order: group.Order,
		})
		if group.Order == 0 {
			next.Groups[len(next.Groups)-1].Order = index
		}
		for _, alias := range group.Hosts {
			if _, exists := groupByHost[alias]; !exists {
				groupByHost[alias] = id
			}
		}
	}
	for _, host := range data.Hosts {
		converted := panelstore.PanelHost{
			Alias: host.Name, HostName: host.HostName, User: host.User,
			Port: host.Port, Password: host.Password, Note: host.Note,
			ProxyJump: host.ProxyJump, ProxyCommand: host.ProxyCommand,
			IdentityAgent: host.IdentityAgent, ForwardAgent: host.ForwardAgent,
			HostKeyAlgos: host.HostKeyAlgos,
		}
		if host.IdentityFile != "" {
			converted.IdentityFiles = []string{host.IdentityFile}
		}
		converted.GroupID = groupByHost[host.Name]
		next.Hosts = append(next.Hosts, converted)
	}
	return &next, nil
}

func normalizeBackupGroups(input []groups.Group) ([]groups.Group, error) {
	out := make([]groups.Group, len(input))
	oldToNew := make(map[string]string, len(input))
	seen := make(map[string]struct{}, len(input))
	for i, group := range input {
		out[i] = group
		oldID := strings.TrimSpace(group.ID)
		name := strings.TrimSpace(group.Name)
		if name == "" {
			name = oldID
		}
		if err := groupid.Validate(name); err != nil {
			return nil, fmt.Errorf("备份分组 %s 无法迁移: %w", oldID, err)
		}
		if _, exists := seen[name]; exists {
			return nil, fmt.Errorf("备份分组名称重复: %s", name)
		}
		seen[name] = struct{}{}
		if oldID != "" {
			oldToNew[oldID] = name
		}
		out[i].ID = name
		out[i].Name = name
	}
	for i := range out {
		if next, ok := oldToNew[strings.TrimSpace(out[i].ParentID)]; ok {
			out[i].ParentID = next
		}
	}
	return out, nil
}

func filterKnownHosts(hosts []string, known map[string]bool) []string {
	out := make([]string, 0, len(hosts))
	for _, host := range hosts {
		if known[host] {
			out = append(out, host)
		}
	}
	return out
}

func hostNameSet(hosts []panelstore.PanelHost) map[string]bool {
	out := make(map[string]bool, len(hosts))
	for _, host := range hosts {
		out[host.Alias] = true
	}
	return out
}

func groupsFromPanelState(state panelstore.State, known map[string]bool) []groups.Group {
	out := make([]groups.Group, 0, len(state.Groups))
	for _, group := range state.Groups {
		members := make([]string, 0)
		for _, host := range state.Hosts {
			if host.GroupID == group.ID && known[host.Alias] {
				members = append(members, host.Alias)
			}
		}
		out = append(out, groups.Group{ID: group.ID, Name: group.Name, ParentID: group.ParentID, BoardTitle: group.BoardTitle, Order: group.Order, Hosts: members})
	}
	return out
}

func mergePanelGroups(current, incoming []panelstore.PanelGroup) []panelstore.PanelGroup {
	byID := make(map[string]panelstore.PanelGroup, len(current)+len(incoming))
	order := make([]string, 0, len(current)+len(incoming))
	for _, group := range current {
		byID[group.ID] = group
		order = append(order, group.ID)
	}
	for _, group := range incoming {
		if _, ok := byID[group.ID]; !ok {
			order = append(order, group.ID)
		}
		byID[group.ID] = group
	}
	out := make([]panelstore.PanelGroup, 0, len(order))
	for _, id := range order {
		out = append(out, byID[id])
	}
	return out
}

func sWriteHostMeta(a *App, host panelstore.PanelHost) error {
	if a == nil || a.panelStore != nil || a.hostMeta == nil {
		return nil
	}
	if err := a.hostMeta.SetNote(host.Alias, host.Note); err != nil {
		return err
	}
	return a.hostMeta.SetPassword(host.Alias, host.Password)
}
