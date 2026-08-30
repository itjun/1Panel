package hostmeta

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

// Record 一台主机的本机备注（不写入 ~/.ssh/config）
type Record struct {
	Host      string `json:"host"`
	Note      string `json:"note"`
	UpdatedAt int64  `json:"updatedAt"`
}

// Store 本机持久化主机备注，数据目录与分组 / 图标一致
type Store struct {
	path string
	mu   sync.RWMutex
	data map[string]*Record
}

// NewStore 数据落盘：
//
//	Windows: %AppData%\<app>\host_meta.json
//	macOS:   ~/Library/Application Support/<app>/host_meta.json
//	Linux:   ~/.config/<app>/host_meta.json
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
		path: filepath.Join(dir, "host_meta.json"),
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
		if r == nil || strings.TrimSpace(r.Note) == "" {
			continue
		}
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Host < out[j].Host
	})
	return out
}

// Get 读取一台主机的备注
func (s *Store) Get(host string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.data[host]
	if !ok || r == nil {
		return ""
	}
	return r.Note
}

// Set 写入或清空备注；内容未变则不落盘。note 为空时删除记录。
func (s *Store) Set(host, note string) error {
	host = strings.TrimSpace(host)
	note = strings.TrimSpace(note)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if note == "" {
		if _, ok := s.data[host]; !ok {
			return nil
		}
		delete(s.data, host)
		return s.saveLocked()
	}
	if existing, ok := s.data[host]; ok && existing.Note == note {
		return nil
	}
	s.data[host] = &Record{
		Host:      host,
		Note:      note,
		UpdatedAt: time.Now().Unix(),
	}
	return s.saveLocked()
}

// Rename 主机改别名时同步备注
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

// Delete 删除一台主机的备注
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
		return fmt.Errorf("解析 host_meta.json 失败: %w", err)
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
