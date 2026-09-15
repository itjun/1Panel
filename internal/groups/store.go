package groups

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// MaxDepth 分组树最大深度（根为 1）
const MaxDepth = 3

// Group 表示一个服务器分组（可嵌套，ParentID 空为顶层）
type Group struct {
	ID         string   `json:"id"`                   // 分组唯一 ID
	Name       string   `json:"name"`                 // 分组显示名
	ParentID   string   `json:"parentId,omitempty"`   // 父分组 ID；空 = 顶层
	BoardTitle string   `json:"boardTitle,omitempty"` // 看板模式中间标题（可空）
	Order      int      `json:"order"`                // 同级排序权重
	Hosts      []string `json:"hosts"`                // 该节点直接包含的 Host 名称
}

// DeleteStats 级联删除统计（供确认文案）
type DeleteStats struct {
	GroupCount int `json:"groupCount"` // 将删除的分组数（含自身）
	HostCount  int `json:"hostCount"`  // 将回到未分组的主机数（子树去重）
}

// Store 管理分组元数据的持久化（线程安全）
type Store struct {
	path string
	mu   sync.RWMutex
	data map[string]*Group // groupID -> Group
}

// NewStore 创建一个分组存储，数据落盘到系统应用数据目录：
//
//	Windows: %AppData%\<app>\groups.json
//	macOS:   ~/Library/Application Support/<app>/groups.json
//	Linux:   ~/.config/<app>/groups.json
func NewStore(appName string) (*Store, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(base, appName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建应用数据目录失败: %w", err)
	}
	s := &Store{
		path: filepath.Join(dir, "groups.json"),
		data: map[string]*Group{},
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// Path 返回数据文件路径
func (s *Store) Path() string { return s.path }

// List 返回所有分组，按 Order 升序
func (s *Store) List() []Group {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Group, 0, len(s.data))
	for _, g := range s.data {
		out = append(out, *g)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// Upsert 创建或更新一个分组；校验 parentId 与深度
func (s *Store) Upsert(g Group) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if g.ID == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	g.ParentID = strings.TrimSpace(g.ParentID)
	if g.ParentID == g.ID {
		return fmt.Errorf("分组不能以自身为父级")
	}
	// 若调用方未带 hosts（常见于只改名），保留原有 hosts，避免误清空
	if existing, ok := s.data[g.ID]; ok {
		if g.Hosts == nil {
			g.Hosts = existing.Hosts
		}
		if g.Order == 0 && existing.Order != 0 {
			g.Order = existing.Order
		}
		if g.BoardTitle == "" && existing.BoardTitle != "" {
			g.BoardTitle = existing.BoardTitle
		}
		// 未显式改父级时：若入参 ParentID 空且原有父级，保留（避免误升顶层）
		// 真正改父级走 MoveGroup；创建子组时 ParentID 非空
		if g.ParentID == "" && existing.ParentID != "" {
			// 允许通过 Upsert 显式清空父级升为顶层（MoveGroup 也走这里的校验路径）
			// 这里若调用方传空，视为「未改父」保留 —— 与 BoardTitle 策略一致
			g.ParentID = existing.ParentID
		}
	}
	if err := s.validateParentLocked(g.ID, g.ParentID); err != nil {
		return err
	}
	// 临时写入以算深度（含自身作为 parent 的子树高度）
	prev, had := s.data[g.ID]
	cp := g
	s.data[g.ID] = &cp
	depth := s.depthLocked(g.ID)
	subH := s.subtreeHeightLocked(g.ID)
	if depth+subH-1 > MaxDepth || depth > MaxDepth {
		if had {
			s.data[g.ID] = prev
		} else {
			delete(s.data, g.ID)
		}
		return fmt.Errorf("分组深度不能超过 %d 层", MaxDepth)
	}
	return s.saveLocked()
}

// MoveGroup 将分组移到新父级下；newParentID 空表示升为顶层
func (s *Store) MoveGroup(id, newParentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id = strings.TrimSpace(id)
	newParentID = strings.TrimSpace(newParentID)
	if id == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	g, ok := s.data[id]
	if !ok {
		return fmt.Errorf("分组 %s 不存在", id)
	}
	if newParentID == id {
		return fmt.Errorf("分组不能以自身为父级")
	}
	if err := s.validateParentLocked(id, newParentID); err != nil {
		return err
	}
	// 禁止拖到自己的子孙下
	if newParentID != "" && s.isAncestorLocked(id, newParentID) {
		return fmt.Errorf("不能将分组移到自己的子分组下")
	}
	oldParent := g.ParentID
	g.ParentID = newParentID
	depth := s.depthLocked(id)
	subH := s.subtreeHeightLocked(id)
	if depth > MaxDepth || depth+subH-1 > MaxDepth {
		g.ParentID = oldParent
		return fmt.Errorf("移动后深度将超过 %d 层", MaxDepth)
	}
	return s.saveLocked()
}

// SetBoardTitle 设置看板中间标题；title 为空表示清空
func (s *Store) SetBoardTitle(id, title string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	title = strings.TrimSpace(title)
	if id == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	g, ok := s.data[id]
	if !ok {
		return fmt.Errorf("分组 %s 不存在", id)
	}
	g.BoardTitle = title
	return s.saveLocked()
}

// Rename 只改分组显示名，不动 hosts/order/parent
func (s *Store) Rename(id, newName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	newName = strings.TrimSpace(newName)
	if id == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	if newName == "" {
		return fmt.Errorf("分组名称不能为空")
	}
	g, ok := s.data[id]
	if !ok {
		return fmt.Errorf("分组 %s 不存在", id)
	}
	for _, other := range s.data {
		if other.ID != id && other.Name == newName {
			return fmt.Errorf("分组名 %s 已存在", newName)
		}
	}
	g.Name = newName
	return s.saveLocked()
}

// PreviewDelete 返回级联删除将影响的分组数与主机数（不落盘）
func (s *Store) PreviewDelete(id string) (DeleteStats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return DeleteStats{}, fmt.Errorf("分组 ID 不能为空")
	}
	if _, ok := s.data[id]; !ok {
		return DeleteStats{}, fmt.Errorf("分组 %s 不存在", id)
	}
	ids := s.descendantIDsLocked(id)
	hostSet := map[string]struct{}{}
	for _, gid := range ids {
		g := s.data[gid]
		if g == nil {
			continue
		}
		for _, h := range g.Hosts {
			if h != "" {
				hostSet[h] = struct{}{}
			}
		}
	}
	return DeleteStats{GroupCount: len(ids), HostCount: len(hostSet)}, nil
}

// Delete 级联删除分组及其全部子孙（主机引用随分组消失，回到未分组）
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	if _, ok := s.data[id]; !ok {
		return fmt.Errorf("分组 %s 不存在", id)
	}
	for _, gid := range s.descendantIDsLocked(id) {
		delete(s.data, gid)
	}
	return s.saveLocked()
}

// AssignHost 把 host 加入指定分组；groupID 为空则从所有分组中移除
func (s *Store) AssignHost(host, groupID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, g := range s.data {
		next := make([]string, 0, len(g.Hosts))
		for _, h := range g.Hosts {
			if h != host {
				next = append(next, h)
			}
		}
		g.Hosts = next
	}
	if groupID != "" {
		if g, ok := s.data[groupID]; ok {
			g.Hosts = append(g.Hosts, host)
		} else {
			return fmt.Errorf("分组 %s 不存在", groupID)
		}
	}
	return s.saveLocked()
}

// RenameHost 把所有分组里的 oldName 替换成 newName
func (s *Store) RenameHost(oldName, newName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for _, g := range s.data {
		for i, h := range g.Hosts {
			if h == oldName {
				g.Hosts[i] = newName
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	return s.saveLocked()
}

// SubtreeHostNames 返回分组子树内全部主机名（去重）
func (s *Store) SubtreeHostNames(id string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := s.descendantIDsLocked(id)
	seen := map[string]struct{}{}
	var out []string
	for _, gid := range ids {
		g := s.data[gid]
		if g == nil {
			continue
		}
		for _, h := range g.Hosts {
			if h == "" {
				continue
			}
			if _, ok := seen[h]; ok {
				continue
			}
			seen[h] = struct{}{}
			out = append(out, h)
		}
	}
	return out
}

// Depth 返回分组深度（根=1）；不存在返回 0
func (s *Store) Depth(id string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.depthLocked(id)
}

// ValidateTree 校验全表无环且深度合法（备份导入用）
func (s *Store) ValidateTree() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return validateGroupMap(s.data)
}

// ValidateGroupList 校验一组分组定义（不落盘；备份导入前预检）
func ValidateGroupList(list []Group) error {
	m := make(map[string]*Group, len(list))
	for i := range list {
		g := list[i]
		if g.ID == "" {
			return fmt.Errorf("分组 ID 不能为空")
		}
		cp := g
		m[g.ID] = &cp
	}
	return validateGroupMap(m)
}

func validateGroupMap(data map[string]*Group) error {
	for id, g := range data {
		if g.ParentID != "" {
			if _, ok := data[g.ParentID]; !ok {
				return fmt.Errorf("分组 %s 的父级 %s 不存在", id, g.ParentID)
			}
			if g.ParentID == id {
				return fmt.Errorf("分组 %s 不能以自身为父级", id)
			}
		}
		d := depthInMap(data, id)
		if d <= 0 {
			return fmt.Errorf("分组 %s 存在环或无效父链", id)
		}
		if d > MaxDepth {
			return fmt.Errorf("分组 %s 深度 %d 超过上限 %d", id, d, MaxDepth)
		}
	}
	return nil
}

func depthInMap(data map[string]*Group, id string) int {
	seen := map[string]bool{}
	d := 0
	cur := id
	for cur != "" {
		if seen[cur] {
			return 0
		}
		seen[cur] = true
		g, ok := data[cur]
		if !ok {
			return 0
		}
		d++
		if d > MaxDepth+2 {
			return 0
		}
		cur = g.ParentID
	}
	return d
}

func (s *Store) validateParentLocked(id, parentID string) error {
	if parentID == "" {
		return nil
	}
	if _, ok := s.data[parentID]; !ok {
		return fmt.Errorf("父分组 %s 不存在", parentID)
	}
	if parentID == id {
		return fmt.Errorf("分组不能以自身为父级")
	}
	return nil
}

// depthLocked：根=1；环或断链返回 0
func (s *Store) depthLocked(id string) int {
	seen := map[string]bool{}
	d := 0
	cur := id
	for cur != "" {
		if seen[cur] {
			return 0
		}
		seen[cur] = true
		g, ok := s.data[cur]
		if !ok {
			return 0
		}
		d++
		if d > MaxDepth+2 {
			return 0
		}
		cur = g.ParentID
	}
	return d
}

// subtreeHeightLocked：以 id 为根的子树高度（单节点=1）
func (s *Store) subtreeHeightLocked(id string) int {
	maxChild := 0
	for _, g := range s.data {
		if g.ParentID == id {
			h := s.subtreeHeightLocked(g.ID)
			if h > maxChild {
				maxChild = h
			}
		}
	}
	return maxChild + 1
}

// isAncestorLocked：ancestorID 是否为 nodeID 的祖先（不含自身）
func (s *Store) isAncestorLocked(ancestorID, nodeID string) bool {
	cur := nodeID
	seen := map[string]bool{}
	for cur != "" {
		if seen[cur] {
			return false
		}
		seen[cur] = true
		g, ok := s.data[cur]
		if !ok {
			return false
		}
		if g.ParentID == ancestorID {
			return true
		}
		cur = g.ParentID
	}
	return false
}

// descendantIDsLocked：含自身的全部子孙 ID
func (s *Store) descendantIDsLocked(id string) []string {
	out := []string{id}
	queue := []string{id}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, g := range s.data {
			if g.ParentID == cur {
				out = append(out, g.ID)
				queue = append(queue, g.ID)
			}
		}
	}
	return out
}

func (s *Store) load() error {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var list []Group
	if err := json.Unmarshal(b, &list); err != nil {
		return fmt.Errorf("解析 groups.json 失败: %w", err)
	}
	for i := range list {
		s.data[list[i].ID] = &list[i]
	}
	return nil
}

func (s *Store) saveLocked() error {
	list := make([]Group, 0, len(s.data))
	for _, g := range s.data {
		list = append(list, *g)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Order != list[j].Order {
			return list[i].Order < list[j].Order
		}
		return list[i].Name < list[j].Name
	})
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0644)
}
