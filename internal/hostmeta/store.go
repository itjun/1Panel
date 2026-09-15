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

// Record 一台主机的本机元数据（备注 + 密码，不写入 ~/.ssh/config）
type Record struct {
	Host      string `json:"host"`
	Note      string `json:"note,omitempty"`
	Password  string `json:"password,omitempty"`
	UpdatedAt int64  `json:"updatedAt"`
}

// Store 本机持久化主机备注与密码，数据目录与分组 / 图标一致
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

// List 返回全部有备注或密码的记录，按主机名排序
func (s *Store) List() []Record {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Record, 0, len(s.data))
	for _, r := range s.data {
		if r == nil {
			continue
		}
		if strings.TrimSpace(r.Note) == "" && r.Password == "" {
			continue
		}
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Host < out[j].Host
	})
	return out
}

// Get 读取一台主机的备注（兼容旧调用名）
func (s *Store) Get(host string) string {
	return s.GetNote(host)
}

// GetNote 读取一台主机的备注
func (s *Store) GetNote(host string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.data[host]
	if !ok || r == nil {
		return ""
	}
	return r.Note
}

// GetPassword 读取一台主机保存的密码（未保存则空串）
func (s *Store) GetPassword(host string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.data[host]
	if !ok || r == nil {
		return ""
	}
	return r.Password
}

// Set 写入或清空备注（兼容旧调用）；保留已有密码。两者皆空则删除记录。
func (s *Store) Set(host, note string) error {
	return s.SetNote(host, note)
}

// SetNote 写入或清空备注；保留已有密码。备注与密码皆空时删除记录。
func (s *Store) SetNote(host, note string) error {
	host = strings.TrimSpace(host)
	note = strings.TrimSpace(note)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.data[host]
	password := ""
	if ok && existing != nil {
		password = existing.Password
		if existing.Note == note {
			return nil
		}
	}
	if note == "" && password == "" {
		if !ok {
			return nil
		}
		delete(s.data, host)
		return s.saveLocked()
	}
	s.data[host] = &Record{
		Host:      host,
		Note:      note,
		Password:  password,
		UpdatedAt: time.Now().Unix(),
	}
	return s.saveLocked()
}

// SetPassword 写入或清空密码；保留已有备注。备注与密码皆空时删除记录。
// 密码不 trim，保留用户输入原样。
func (s *Store) SetPassword(host, password string) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.data[host]
	note := ""
	if ok && existing != nil {
		note = existing.Note
		if existing.Password == password {
			return nil
		}
	}
	if note == "" && password == "" {
		if !ok {
			return nil
		}
		delete(s.data, host)
		return s.saveLocked()
	}
	s.data[host] = &Record{
		Host:      host,
		Note:      note,
		Password:  password,
		UpdatedAt: time.Now().Unix(),
	}
	return s.saveLocked()
}

// Rename 主机改别名时同步备注与密码
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

// Delete 删除一台主机的备注与密码
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
	return os.WriteFile(s.path, b, 0600)
}
