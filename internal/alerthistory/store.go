package alerthistory

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const maxEvents = 2000

// Event 一条应用内告警历史（资源超阈 / 回落）。
type Event struct {
	ID     string `json:"id"`
	Host   string `json:"host"`
	Kind   string `json:"kind"`  // cpu|mem|disk|load
	State  string `json:"state"` // down|up
	Title  string `json:"title"`
	Detail string `json:"detail"`
	At     int64  `json:"at"` // unix ms
	Read   bool   `json:"read"`
}

// Store 管理告警历史持久化（线程安全）。
type Store struct {
	path   string
	mu     sync.RWMutex
	events []Event // 新→旧
}

// NewStore 创建告警历史存储，数据落盘到系统应用数据目录：
//
//	Windows: %AppData%\<app>\alert_history.json
//	macOS:   ~/Library/Application Support/<app>/alert_history.json
//	Linux:   ~/.config/<app>/alert_history.json
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
		path:   filepath.Join(dir, "alert_history.json"),
		events: nil,
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// Path 返回数据文件路径。
func (s *Store) Path() string { return s.path }

// List 返回最近 limit 条（新→旧）；limit≤0 表示全部。
func (s *Store) List(limit int) []Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return clonePrefix(s.events, limit)
}

// ListByHost 返回指定主机最近 limit 条（新→旧）；limit≤0 表示该主机全部。
func (s *Store) ListByHost(host string, limit int) []Event {
	host = strings.TrimSpace(host)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if host == "" {
		return clonePrefix(s.events, limit)
	}
	out := make([]Event, 0)
	for _, e := range s.events {
		if e.Host != host {
			continue
		}
		out = append(out, e)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// Append 追加一条事件：空 ID 则生成 uuid；At 为 0 则用当前时间。返回落盘后的事件。
func (s *Store) Append(e Event) (Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	e.Host = strings.TrimSpace(e.Host)
	e.Kind = strings.TrimSpace(e.Kind)
	e.State = strings.TrimSpace(e.State)
	e.Title = strings.TrimSpace(e.Title)
	e.Detail = strings.TrimSpace(e.Detail)
	if e.ID == "" {
		e.ID = uuid.NewString()
	}
	if e.At == 0 {
		e.At = time.Now().UnixMilli()
	}

	s.events = append([]Event{e}, s.events...)
	if len(s.events) > maxEvents {
		s.events = s.events[:maxEvents]
	}
	if err := s.saveLocked(); err != nil {
		return Event{}, err
	}
	return e, nil
}

// MarkRead 将指定 id 标为已读。
func (s *Store) MarkRead(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("事件 ID 不能为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.events {
		if s.events[i].ID == id {
			if s.events[i].Read {
				return nil
			}
			s.events[i].Read = true
			return s.saveLocked()
		}
	}
	return fmt.Errorf("事件不存在: %s", id)
}

// MarkAllRead 将已读；host 非空则只标该主机，空则全部。
func (s *Store) MarkAllRead(host string) error {
	host = strings.TrimSpace(host)
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for i := range s.events {
		if host != "" && s.events[i].Host != host {
			continue
		}
		if !s.events[i].Read {
			s.events[i].Read = true
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return s.saveLocked()
}

// Clear 清空全部告警历史。
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = nil
	return s.saveLocked()
}

// UnreadCount 未读条数。
func (s *Store) UnreadCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := 0
	for _, e := range s.events {
		if !e.Read {
			n++
		}
	}
	return n
}

func clonePrefix(src []Event, limit int) []Event {
	n := len(src)
	if limit > 0 && limit < n {
		n = limit
	}
	out := make([]Event, n)
	copy(out, src[:n])
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
	var list []Event
	if err := json.Unmarshal(b, &list); err != nil {
		return fmt.Errorf("解析 alert_history.json 失败: %w", err)
	}
	s.events = list
	if len(s.events) > maxEvents {
		s.events = s.events[:maxEvents]
	}
	return nil
}

func (s *Store) saveLocked() error {
	b, err := json.MarshalIndent(s.events, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0644)
}
