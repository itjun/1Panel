package main

import (
	"fmt"
	"sort"
	"strings"

	"diteng-pannel/internal/groupid"
	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/panelstore"
)

// Groups 分组管理服务（本地存储，不修改服务器）
type Groups App

// ============ 分组 ============

// ListGroups 返回全部分组（按 order 排序）
func (s *Groups) ListGroups() []groups.Group {
	if a := (*App)(s); a.panelStore != nil {
		return panelGroupsAsLegacy(a.panelStore.Snapshot())
	}
	if s.groups == nil {
		return []groups.Group{}
	}
	return s.groups.List()
}

// UpsertGroup 创建或更新分组（可带 parentId）
func (s *Groups) UpsertGroup(g groups.Group) error {
	g.ID = strings.TrimSpace(g.ID)
	g.Name = strings.TrimSpace(g.Name)
	if g.ID == "" {
		g.ID = g.Name
	}
	if g.ID != g.Name {
		return fmt.Errorf("分组 ID 必须与分组名称一致")
	}
	if err := groupid.Validate(g.ID); err != nil {
		return err
	}
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return s.mutatePanelGroups(func(state *panelstore.State) error {
			return upsertPanelGroup(state, panelstore.PanelGroup{
				ID: g.ID, Name: g.Name, ParentID: strings.TrimSpace(g.ParentID),
				BoardTitle: strings.TrimSpace(g.BoardTitle), Order: g.Order,
			})
		})
	}
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	if err := s.groups.Upsert(g); err != nil {
		return err
	}
	return s.syncPanelModel()
}

// RenameGroup 重命名分组。Group ID 与名称绑定，因此重命名会同步迁移 ID、主机引用和生成配置文件。
func (s *Groups) RenameGroup(id, newName string) (string, error) {
	id = strings.TrimSpace(id)
	if s.groups == nil {
		if a := (*App)(s); a == nil || a.panelStore == nil {
			return "", fmt.Errorf("分组存储未初始化")
		}
	}
	newName = strings.TrimSpace(newName)
	if err := groupid.Validate(newName); err != nil {
		return "", err
	}
	if a := (*App)(s); a != nil && a.panelStore != nil {
		if err := s.mutatePanelGroups(func(state *panelstore.State) error {
			return renamePanelGroup(state, id, newName)
		}); err != nil {
			return "", err
		}
		return newName, nil
	}
	if err := s.groups.Rename(id, newName); err != nil {
		return "", err
	}
	if err := s.syncPanelModel(); err != nil {
		return "", err
	}
	return strings.TrimSpace(newName), nil
}

// SetBoardTitle 设置分组看板中间标题；title 为空表示清空
func (s *Groups) SetBoardTitle(id, title string) error {
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return s.mutatePanelGroups(func(state *panelstore.State) error {
			idx := panelGroupIndex(*state, id)
			if idx < 0 {
				return fmt.Errorf("分组 %s 不存在", strings.TrimSpace(id))
			}
			state.Groups[idx].BoardTitle = strings.TrimSpace(title)
			return nil
		})
	}
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	if err := s.groups.SetBoardTitle(id, title); err != nil {
		return err
	}
	return s.syncPanelModel()
}

// MoveGroup 将分组移到新父级；parentID 空表示升为顶层
func (s *Groups) MoveGroup(id, parentID string) error {
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return s.mutatePanelGroups(func(state *panelstore.State) error {
			return movePanelGroup(state, id, parentID)
		})
	}
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	if err := s.groups.MoveGroup(id, parentID); err != nil {
		return err
	}
	return s.syncPanelModel()
}

// ReorderGroups 拖拽排序：按前端给定的同级顺序重排分组 order（依次 0,1,2…）
func (s *Groups) ReorderGroups(parentID string, orderedIDs []string) error {
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return s.mutatePanelGroups(func(state *panelstore.State) error {
			return reorderPanelGroups(state, parentID, orderedIDs)
		})
	}
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	if err := s.groups.ReorderGroups(parentID, orderedIDs); err != nil {
		return err
	}
	return s.syncPanelModel()
}

// PreviewDeleteGroup 预览级联删除影响（确认对话框用）
func (s *Groups) PreviewDeleteGroup(id string) (groups.DeleteStats, error) {
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return previewPanelGroupDelete(a.panelStore.Snapshot(), id)
	}
	if s.groups == nil {
		return groups.DeleteStats{}, fmt.Errorf("分组存储未初始化")
	}
	return s.groups.PreviewDelete(id)
}

// DeleteGroup 级联删除分组及其子孙
func (s *Groups) DeleteGroup(id string) error {
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return s.mutatePanelGroups(func(state *panelstore.State) error {
			return deletePanelGroup(state, id)
		})
	}
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	if err := s.groups.Delete(id); err != nil {
		return err
	}
	return s.syncPanelModel()
}

// ReorderHosts 拖拽排序：按前端给定顺序重排分组内主机
func (s *Groups) ReorderHosts(groupID string, orderedNames []string) error {
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return s.mutatePanelGroups(func(state *panelstore.State) error {
			return reorderPanelGroupHosts(state, groupID, orderedNames)
		})
	}
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	if err := s.groups.ReorderHosts(groupID, orderedNames); err != nil {
		return err
	}
	return s.syncPanelModel()
}

// AssignHost 把主机分配到分组；groupID 为空表示移出所有分组（未分组）
func (s *Groups) AssignHost(host, groupID string) error {
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return s.mutatePanelGroups(func(state *panelstore.State) error {
			return assignPanelHost(state, host, groupID)
		})
	}
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	if err := s.groups.AssignHost(host, groupID); err != nil {
		return err
	}
	return s.syncPanelModel()
}

// SubtreeHostNames 返回分组子树内主机名
func (s *Groups) SubtreeHostNames(id string) []string {
	if a := (*App)(s); a != nil && a.panelStore != nil {
		return panelSubtreeHostNames(a.panelStore.Snapshot(), id)
	}
	if s.groups == nil {
		return nil
	}
	return s.groups.SubtreeHostNames(id)
}

// mutatePanelGroups is the single mutation seam for the Panel-backed group
// API. Panel JSON is authoritative; groups.json is refreshed only as a
// compatibility cache after the Panel mutation has been persisted. The cache
// is also refreshed when generation fails after the JSON draft was committed,
// so a config-stale state cannot make the next group edit look missing.
func (s *Groups) mutatePanelGroups(mutate func(*panelstore.State) error) error {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	before := a.panelStore.Snapshot().Revision
	err := a.mutatePanelStateAndGenerate([]string{}, mutate)
	after := a.panelStore.Snapshot()
	if after.Revision != before {
		if syncErr := a.syncLegacyGroupsFromPanel(after); err == nil && syncErr != nil {
			return syncErr
		}
	}
	return err
}

func panelGroupIndex(state panelstore.State, id string) int {
	id = strings.TrimSpace(id)
	for i, group := range state.Groups {
		if group.ID == id {
			return i
		}
	}
	return -1
}

func upsertPanelGroup(state *panelstore.State, next panelstore.PanelGroup) error {
	next.ID = strings.TrimSpace(next.ID)
	next.Name = strings.TrimSpace(next.Name)
	next.ParentID = strings.TrimSpace(next.ParentID)
	if next.ID == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	if next.ID != next.Name {
		return fmt.Errorf("分组 ID 必须与分组名称一致")
	}
	if err := groupid.Validate(next.ID); err != nil {
		return err
	}
	if next.ParentID != "" {
		if panelGroupIndex(*state, next.ParentID) < 0 {
			return fmt.Errorf("父分组 %s 不存在", next.ParentID)
		}
		return fmt.Errorf("分组深度不能超过 %d 层", groups.MaxDepth)
	}
	idx := panelGroupIndex(*state, next.ID)
	if idx >= 0 {
		current := state.Groups[idx]
		if next.Order == 0 && current.Order != 0 {
			next.Order = current.Order
		}
		if next.BoardTitle == "" {
			next.BoardTitle = current.BoardTitle
		}
		if next.Color == "" {
			next.Color = current.Color
		}
		state.Groups[idx] = next
		return nil
	}
	for _, group := range state.Groups {
		if group.ID == next.ID || group.Name == next.Name {
			return fmt.Errorf("分组名 %s 已存在", next.Name)
		}
	}
	state.Groups = append(state.Groups, next)
	return nil
}

func renamePanelGroup(state *panelstore.State, id, newName string) error {
	id = strings.TrimSpace(id)
	newName = strings.TrimSpace(newName)
	idx := panelGroupIndex(*state, id)
	if idx < 0 {
		return fmt.Errorf("分组 %s 不存在", id)
	}
	if err := groupid.Validate(newName); err != nil {
		return err
	}
	if id == newName {
		state.Groups[idx].Name = newName
		return nil
	}
	for _, group := range state.Groups {
		if group.ID != id && (group.ID == newName || group.Name == newName) {
			return fmt.Errorf("分组名 %s 已存在", newName)
		}
	}
	state.Groups[idx].ID = newName
	state.Groups[idx].Name = newName
	for i := range state.Groups {
		if state.Groups[i].ParentID == id {
			state.Groups[i].ParentID = newName
		}
	}
	for i := range state.Hosts {
		if state.Hosts[i].GroupID == id {
			state.Hosts[i].GroupID = newName
		}
	}
	migratePanelGroupConfigPaths(state, id, newName)
	return nil
}

func migratePanelGroupConfigPaths(state *panelstore.State, oldID, newID string) {
	oldPath := "config.d/" + oldID + ".conf"
	newPath := "config.d/" + newID + ".conf"
	for _, file := range state.ConfigLayout.Files {
		if file.Path != oldPath {
			continue
		}
		for _, existing := range state.ConfigLayout.Files {
			if existing.Path == newPath {
				return
			}
		}
		copy := file
		copy.Path = newPath
		state.ConfigLayout.Files = append(state.ConfigLayout.Files, copy)
		return
	}
	// Keep the old generated path until the generator computes RemovedFiles.
	// Otherwise the physical config.d/<old-id>.conf would be left behind after
	// a successful rename because the diff would no longer know it was managed.
}

func movePanelGroup(state *panelstore.State, id, parentID string) error {
	id = strings.TrimSpace(id)
	parentID = strings.TrimSpace(parentID)
	idx := panelGroupIndex(*state, id)
	if idx < 0 {
		return fmt.Errorf("分组 %s 不存在", id)
	}
	if parentID != "" {
		if panelGroupIndex(*state, parentID) < 0 {
			return fmt.Errorf("父分组 %s 不存在", parentID)
		}
		return fmt.Errorf("分组深度不能超过 %d 层", groups.MaxDepth)
	}
	state.Groups[idx].ParentID = ""
	return nil
}

func reorderPanelGroups(state *panelstore.State, parentID string, orderedIDs []string) error {
	parentID = strings.TrimSpace(parentID)
	if parentID != "" && panelGroupIndex(*state, parentID) < 0 {
		return fmt.Errorf("父分组 %s 不存在", parentID)
	}
	siblings := make([]int, 0, len(state.Groups))
	byID := make(map[string]int, len(state.Groups))
	for i, group := range state.Groups {
		byID[group.ID] = i
		if strings.TrimSpace(group.ParentID) == parentID {
			siblings = append(siblings, i)
		}
	}
	sort.SliceStable(siblings, func(i, j int) bool {
		a, b := state.Groups[siblings[i]], state.Groups[siblings[j]]
		if a.Order != b.Order {
			return a.Order < b.Order
		}
		return a.ID < b.ID
	})
	ordered := make([]int, 0, len(siblings))
	seen := make(map[string]struct{}, len(siblings))
	for _, id := range orderedIDs {
		id = strings.TrimSpace(id)
		idx, ok := byID[id]
		if !ok {
			return fmt.Errorf("分组 %s 不存在", id)
		}
		if strings.TrimSpace(state.Groups[idx].ParentID) != parentID {
			return fmt.Errorf("分组 %s 不在目标层级下", id)
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ordered = append(ordered, idx)
	}
	for _, idx := range siblings {
		if _, ok := seen[state.Groups[idx].ID]; ok {
			continue
		}
		ordered = append(ordered, idx)
	}
	for order, idx := range ordered {
		state.Groups[idx].Order = order
	}
	return nil
}

func previewPanelGroupDelete(state panelstore.State, id string) (groups.DeleteStats, error) {
	id = strings.TrimSpace(id)
	if panelGroupIndex(state, id) < 0 {
		return groups.DeleteStats{}, fmt.Errorf("分组 %s 不存在", id)
	}
	ids := panelGroupSubtreeIDs(state, id)
	hosts := make(map[string]struct{})
	for _, host := range state.Hosts {
		if ids[host.GroupID] {
			hosts[host.Alias] = struct{}{}
		}
	}
	return groups.DeleteStats{GroupCount: len(ids), HostCount: len(hosts)}, nil
}

func deletePanelGroup(state *panelstore.State, id string) error {
	id = strings.TrimSpace(id)
	if panelGroupIndex(*state, id) < 0 {
		return fmt.Errorf("分组 %s 不存在", id)
	}
	ids := panelGroupSubtreeIDs(*state, id)
	kept := state.Groups[:0]
	for _, group := range state.Groups {
		if !ids[group.ID] {
			kept = append(kept, group)
		}
	}
	state.Groups = kept
	for i := range state.Hosts {
		if ids[state.Hosts[i].GroupID] {
			state.Hosts[i].GroupID = ""
			state.Hosts[i].Order = 0
		}
	}
	return nil
}

func panelGroupSubtreeIDs(state panelstore.State, root string) map[string]bool {
	ids := map[string]bool{strings.TrimSpace(root): true}
	changed := true
	for changed {
		changed = false
		for _, group := range state.Groups {
			if group.ParentID != "" && ids[group.ParentID] && !ids[group.ID] {
				ids[group.ID] = true
				changed = true
			}
		}
	}
	return ids
}

func reorderPanelGroupHosts(state *panelstore.State, groupID string, orderedNames []string) error {
	groupID = strings.TrimSpace(groupID)
	if panelGroupIndex(*state, groupID) < 0 {
		return fmt.Errorf("分组 %s 不存在", groupID)
	}
	indices := make([]int, 0)
	byAlias := make(map[string]int)
	for i, host := range state.Hosts {
		if host.GroupID != groupID {
			continue
		}
		indices = append(indices, i)
		byAlias[host.Alias] = i
	}
	sort.SliceStable(indices, func(i, j int) bool {
		a, b := state.Hosts[indices[i]], state.Hosts[indices[j]]
		if a.Order != b.Order {
			return a.Order < b.Order
		}
		return a.Alias < b.Alias
	})
	ordered := make([]int, 0, len(indices))
	seen := make(map[string]struct{}, len(indices))
	for _, alias := range orderedNames {
		alias = strings.TrimSpace(alias)
		idx, ok := byAlias[alias]
		if !ok {
			continue
		}
		if _, ok := seen[alias]; ok {
			continue
		}
		seen[alias] = struct{}{}
		ordered = append(ordered, idx)
	}
	for _, idx := range indices {
		if _, ok := seen[state.Hosts[idx].Alias]; ok {
			continue
		}
		ordered = append(ordered, idx)
	}
	for order, idx := range ordered {
		state.Hosts[idx].Order = order
	}
	return nil
}

func assignPanelHost(state *panelstore.State, host, groupID string) error {
	host = strings.TrimSpace(host)
	groupID = strings.TrimSpace(groupID)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	if groupID != "" && panelGroupIndex(*state, groupID) < 0 {
		return fmt.Errorf("分组 %s 不存在", groupID)
	}
	hostIndex := -1
	for i := range state.Hosts {
		if state.Hosts[i].Alias == host {
			hostIndex = i
			break
		}
		if state.Hosts[i].GroupID == groupID && groupID != "" {
			state.Hosts[i].Order++
		}
	}
	if hostIndex < 0 {
		return fmt.Errorf("未找到主机: %s", host)
	}
	state.Hosts[hostIndex].GroupID = groupID
	if groupID == "" {
		state.Hosts[hostIndex].Order = 0
	} else {
		maxOrder := -1
		for _, item := range state.Hosts {
			if item.GroupID == groupID && item.Alias != host && item.Order > maxOrder {
				maxOrder = item.Order
			}
		}
		state.Hosts[hostIndex].Order = maxOrder + 1
	}
	return nil
}

func panelSubtreeHostNames(state panelstore.State, id string) []string {
	ids := panelGroupSubtreeIDs(state, id)
	seen := map[string]struct{}{}
	out := make([]string, 0)
	for _, host := range state.Hosts {
		if !ids[host.GroupID] {
			continue
		}
		if _, ok := seen[host.Alias]; ok {
			continue
		}
		seen[host.Alias] = struct{}{}
		out = append(out, host.Alias)
	}
	return out
}

// syncPanelModel keeps the legacy groups store as a UI compatibility cache,
// while Panel JSON owns the group-to-config-file mapping and host membership.
func (s *Groups) syncPanelModel() error {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return nil
	}
	legacy := s.groups.List()
	return a.mutatePanelStateAndGenerate([]string{}, func(state *panelstore.State) error {
		colors := make(map[string]string, len(state.Groups))
		for _, g := range state.Groups {
			colors[g.ID] = g.Color
		}
		state.Groups = make([]panelstore.PanelGroup, 0, len(legacy))
		membership := make(map[string]struct {
			id    string
			order int
		})
		for _, g := range legacy {
			state.Groups = append(state.Groups, panelstore.PanelGroup{
				ID: g.ID, Name: g.Name, ParentID: g.ParentID,
				BoardTitle: g.BoardTitle, Order: g.Order, Color: colors[g.ID],
			})
			for order, host := range g.Hosts {
				membership[host] = struct {
					id    string
					order int
				}{id: g.ID, order: order}
			}
		}
		for i := range state.Hosts {
			state.Hosts[i].GroupID = ""
			state.Hosts[i].Order = 0
			if member, ok := membership[state.Hosts[i].Alias]; ok {
				state.Hosts[i].GroupID = member.id
				state.Hosts[i].Order = member.order
			}
		}
		return nil
	})
}
