package menucheck

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const storeFile = "menu_checks.json"

type fileState struct {
	Items []Item `json:"items"`
}

// Store 巡检配置（本机应用数据目录，0600：请求头里可能带 Token）。
//
//	macOS:   ~/Library/Application Support/<app>/menu_checks.json
//	Windows: %AppData%\<app>\menu_checks.json
//	Linux:   ~/.config/<app>/menu_checks.json
type Store struct {
	path  string
	mu    sync.RWMutex
	items []Item
}

// NewStore 打开应用数据目录下的配置文件。
func NewStore(appName string) (*Store, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	return OpenStore(filepath.Join(base, appName, storeFile))
}

// OpenStore 打开指定路径的配置文件；不存在时为空列表。
func OpenStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("创建应用数据目录失败: %w", err)
	}
	s := &Store{path: path}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// List 返回全部巡检项副本（保持用户添加顺序）。
func (s *Store) List() []Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Item, 0, len(s.items))
	for _, it := range s.items {
		out = append(out, cloneItem(it))
	}
	return out
}

// Get 按 ID 取一项。
func (s *Store) Get(id string) (Item, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, it := range s.items {
		if it.ID == id {
			return cloneItem(it), true
		}
	}
	return Item{}, false
}

// Upsert 新增（ID 为空）或覆盖同 ID 的项，返回落盘后的值。
func (s *Store) Upsert(it Item) (Item, error) {
	it = Normalize(it)
	if err := Validate(it); err != nil {
		return Item{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if it.ID == "" {
		it.ID = newID()
		s.items = append(s.items, cloneItem(it))
	} else {
		found := false
		for i := range s.items {
			if s.items[i].ID == it.ID {
				s.items[i] = cloneItem(it)
				found = true
				break
			}
		}
		if !found {
			return Item{}, fmt.Errorf("巡检项不存在")
		}
	}
	if err := s.saveLocked(); err != nil {
		return Item{}, err
	}
	return cloneItem(it), nil
}

// Delete 删除一项；不存在时不报错。
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.items[:0]
	for _, it := range s.items {
		if it.ID != id {
			out = append(out, it)
		}
	}
	s.items = out
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
	var raw fileState
	if err := json.Unmarshal(b, &raw); err != nil {
		return fmt.Errorf("解析 %s 失败: %w", storeFile, err)
	}
	items := make([]Item, 0, len(raw.Items))
	for _, it := range raw.Items {
		it = Normalize(it)
		if it.ID == "" {
			continue
		}
		items = append(items, it)
	}
	s.items = items
	return nil
}

func (s *Store) saveLocked() error {
	b, err := json.MarshalIndent(fileState{Items: s.items}, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".menu-checks-*.json")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, s.path)
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
