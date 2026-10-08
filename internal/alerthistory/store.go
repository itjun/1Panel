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
// 告警与其恢复共用 IncidentID（= 告警事件自己的 ID），前端据此合并成一次事件。
type Event struct {
	ID         string   `json:"id"`
	IncidentID string   `json:"incidentId"`
	Host       string   `json:"host"`
	Kind       string   `json:"kind"`  // cpu|mem|disk|load|cert|app:<service>
	State      string   `json:"state"` // down|up
	Title      string   `json:"title"`
	Detail     string   `json:"detail"`
	Metric     string   `json:"metric"`
	Value      string   `json:"value"` // 当时读数；恢复事件为回落时的读数
	Threshold  string   `json:"threshold"`
	Peak       string   `json:"peak"`  // 仅恢复事件：告警期间峰值
	Level      string   `json:"level"` // 资源告警档位：warn / danger；其他类型为空
	Stage      string   `json:"stage"` // 资源告警阶段：fire 首发 / escalate 升级 / repeat 重复提醒；其他为空
	Service    string   `json:"service"`
	Channels   []string `json:"channels"` // system|inApp|wecom，实际尝试发送的渠道
	At         int64    `json:"at"`       // unix ms
	Read       bool     `json:"read"`
}

const (
	historyFile       = "alert_history.v2.json"
	legacyHistoryFile = "alert_history.json"
)

// Store 管理告警历史持久化（线程安全）。
type Store struct {
	path   string
	mu     sync.RWMutex
	events []Event // 新→旧
}

// NewStore 创建告警历史存储，数据落盘到系统应用数据目录：
//
//	Windows: %AppData%\<app>\alert_history.v2.json
//	macOS:   ~/Library/Application Support/<app>/alert_history.v2.json
//	Linux:   ~/.config/<app>/alert_history.v2.json
//
// 旧版 alert_history.json 只有纯文本正文，启动时直接删除，不迁移。
func NewStore(appName string) (*Store, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(base, appName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建应用数据目录失败: %w", err)
	}
	_ = os.Remove(filepath.Join(dir, legacyHistoryFile))
	s := &Store{
		path:   filepath.Join(dir, historyFile),
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
	e.IncidentID = strings.TrimSpace(e.IncidentID)
	e.Metric = strings.TrimSpace(e.Metric)
	e.Value = strings.TrimSpace(e.Value)
	e.Threshold = strings.TrimSpace(e.Threshold)
	e.Peak = strings.TrimSpace(e.Peak)
	e.Level = strings.TrimSpace(e.Level)
	e.Stage = strings.TrimSpace(e.Stage)
	e.Service = strings.TrimSpace(e.Service)
	if e.Channels == nil {
		e.Channels = []string{}
	}
	if e.ID == "" {
		e.ID = uuid.NewString()
	}
	if e.IncidentID == "" {
		e.IncidentID = e.ID
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

// Delete 删除指定 id 的事件，返回实际删除条数；不存在的 id 忽略。
func (s *Store) Delete(ids []string) (int, error) {
	drop := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" {
			drop[id] = true
		}
	}
	if len(drop) == 0 {
		return 0, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := make([]Event, 0, len(s.events))
	for _, e := range s.events {
		if !drop[e.ID] {
			kept = append(kept, e)
		}
	}
	removed := len(s.events) - len(kept)
	if removed == 0 {
		return 0, nil
	}
	s.events = kept
	return removed, s.saveLocked()
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
		return fmt.Errorf("解析 %s 失败: %w", historyFile, err)
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
