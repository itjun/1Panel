package hosticon

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Record 一台主机已确认的发行版（用于侧栏/概览图标，操作系统几乎不变）
type Record struct {
	Host      string `json:"host"`
	OSRelease string `json:"osRelease"`
	UpdatedAt int64  `json:"updatedAt"`
}

// Store 本机持久化主机发行版图标，数据目录与分组一致
type Store struct {
	path string
	mu   sync.RWMutex
	data map[string]*Record
}

// NewStore 数据落盘到系统应用数据目录：
//
//	Windows: %AppData%\<app>\host_icons.json
//	macOS:   ~/Library/Application Support/<app>/host_icons.json
//	Linux:   ~/.config/<app>/host_icons.json
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
		path: filepath.Join(dir, "host_icons.json"),
		data: map[string]*Record{},
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// List 返回全部记录，按主机名排序
func (s *Store) List() []Record {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Record, 0, len(s.data))
	for _, r := range s.data {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Host < out[j].Host
	})
	return out
}

// Get 读取一台主机的记录
func (s *Store) Get(host string) (Record, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.data[host]
	if !ok || r == nil {
		return Record{}, false
	}
	return *r, true
}

// Put 写入或更新一台主机的发行版；内容未变则不落盘
func (s *Store) Put(host, osRelease string) error {
	host = strings.TrimSpace(host)
	osRelease = strings.TrimSpace(osRelease)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	if osRelease == "" {
		return fmt.Errorf("发行版不能为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.data[host]; ok && existing.OSRelease == osRelease {
		return nil
	}
	s.data[host] = &Record{
		Host:      host,
		OSRelease: osRelease,
		UpdatedAt: time.Now().Unix(),
	}
	return s.saveLocked()
}

// Rename 主机改别名时同步图标记录
func (s *Store) Rename(oldName, newName string) error {
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == "" || newName == "" || oldName == newName {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.data[oldName]
	if !ok {
		return nil
	}
	delete(s.data, oldName)
	cp := *rec
	cp.Host = newName
	cp.UpdatedAt = time.Now().Unix()
	s.data[newName] = &cp
	return s.saveLocked()
}

// Delete 删除一台主机的图标记录
func (s *Store) Delete(host string) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data[host]; !ok {
		return nil
	}
	delete(s.data, host)
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
	var list []Record
	if err := json.Unmarshal(b, &list); err != nil {
		return fmt.Errorf("解析 host_icons.json 失败: %w", err)
	}
	for i := range list {
		if list[i].Host == "" {
			continue
		}
		cp := list[i]
		s.data[cp.Host] = &cp
	}
	return nil
}

func (s *Store) saveLocked() error {
	list := make([]Record, 0, len(s.data))
	for _, r := range s.data {
		list = append(list, *r)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].Host < list[j].Host
	})
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0644)
}
