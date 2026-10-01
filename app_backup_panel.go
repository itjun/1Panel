package main

import (
	"fmt"
	"strings"

	"diteng-pannel/internal/groupid"
	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/hosticon"
	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
	"diteng-pannel/internal/sshconfig"
)

// legacyBackupData 旧版（v1）单 JSON 备份结构，仅用于读取兼容
type legacyBackupData struct {
	Version     int                    `json:"version"`
	ExportedAt  int64                  `json:"exportedAt"`
	Hosts       []sshconfig.HostConfig `json:"hosts"`
	Groups      []groups.Group         `json:"groups"`
	Icons       []hosticon.Record      `json:"icons"`
	PanelState  *panelstore.State      `json:"panelState,omitempty"`
	ConfigFiles []panelsync.ConfigFile `json:"configFiles,omitempty"`
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

func legacyBackupPanelState(current panelstore.State, data *legacyBackupData) (*panelstore.State, error) {
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

func hostNameSet(hosts []panelstore.PanelHost) map[string]bool {
	out := make(map[string]bool, len(hosts))
	for _, host := range hosts {
		out[host.Alias] = true
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
