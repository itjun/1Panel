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

// Group 表示一个服务器分组
type Group struct {
	ID         string   `json:"id"`                   // 分组唯一 ID（UUID）
	Name       string   `json:"name"`                 // 分组显示名
	BoardTitle string   `json:"boardTitle,omitempty"` // 看板模式中间标题（可空）
	Order      int      `json:"order"`                // 排序权重
	Hosts      []string `json:"hosts"`                // 该分组包含的 Host 名称
}

// Store 管理分组元数据的持久化（线程安全）
type Store struct {
	path string
	mu   sync.RWMutex
	data map[string]*Group // groupID -> Group
}

// NewStore 创建一个分组存储，数据落盘到系统应用数据目录：
//   Windows: %AppData%\<app>\groups.json
//   macOS:   ~/Library/Application Support/<app>/groups.json
//   Linux:   ~/.config/<app>/groups.json
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

// Path 返回数据文件路径（前端可能用于在文件管理器中显示）
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

// Upsert 创建或更新一个分组
func (s *Store) Upsert(g Group) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if g.ID == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	// 若调用方未带 hosts（常见于只改名），保留原有 hosts，避免误清空
	if existing, ok := s.data[g.ID]; ok {
		if g.Hosts == nil {
			g.Hosts = existing.Hosts
		}
		if g.Order == 0 && existing.Order != 0 {
			g.Order = existing.Order
		}
		// 入参看板标题为空时保留原值；真正清空走 SetBoardTitle("")
		if g.BoardTitle == "" && existing.BoardTitle != "" {
			g.BoardTitle = existing.BoardTitle
		}
	}
	cp := g
	s.data[g.ID] = &cp
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

// Rename 只改分组显示名，不动 hosts/order
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

// Delete 删除一个分组
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, id)
	return s.saveLocked()
}

// AssignHost 把 host 加入指定分组；如果 groupID 为空，则从所有分组中移除
func (s *Store) AssignHost(host, groupID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// 先从所有分组中移除
	for _, g := range s.data {
		next := make([]string, 0, len(g.Hosts))
		for _, h := range g.Hosts {
			if h != host {
				next = append(next, h)
			}
		}
		g.Hosts = next
	}
	// 再加入目标分组
	if groupID != "" {
		if g, ok := s.data[groupID]; ok {
			g.Hosts = append(g.Hosts, host)
		} else {
			return fmt.Errorf("分组 %s 不存在", groupID)
		}
	}
	return s.saveLocked()
}

// RenameHost 把所有分组里的 oldName 替换成 newName（主机改名时同步分组引用）
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
		return nil // 没有分组引用该主机，无需落盘
	}
	return s.saveLocked()
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
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0644)
}
