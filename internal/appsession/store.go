package appsession

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

var maxSessions = 5000

const (
	sessionsFile = "app_sessions.json"

	EndNormal   = "normal"
	EndAbnormal = "abnormal"
)

// Session 一次应用进程的运行记录（启动 → 退出）。
type Session struct {
	ID          string `json:"id"`
	StartAt     int64  `json:"startAt"`     // unix ms
	EndAt       int64  `json:"endAt"`       // unix ms；0 表示仍在运行
	LastSeenAt  int64  `json:"lastSeenAt"`  // unix ms；心跳时间，异常退出时作为退出时间
	DurationSec int64  `json:"durationSec"` // 结束后写入
	EndReason   string `json:"endReason"`   // normal|abnormal；运行中为空
	Version     string `json:"version"`
}

// Store 管理会话记录持久化（线程安全）。
type Store struct {
	path      string
	now       func() time.Time
	mu        sync.RWMutex
	sessions  []Session // 新→旧
	currentID string
}

// NewStore 数据落盘到系统应用数据目录下的 app_sessions.json。
func NewStore(appName string) (*Store, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(base, appName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建应用数据目录失败: %w", err)
	}
	return newStoreAt(filepath.Join(dir, sessionsFile), time.Now)
}

func newStoreAt(path string, now func() time.Time) (*Store, error) {
	s := &Store{path: path, now: now}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// Begin 补全上次未正常结束的会话，然后开始一条新会话。
func (s *Store) Begin(version string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.sessions {
		if s.sessions[i].EndAt != 0 {
			continue
		}
		sess := &s.sessions[i]
		end := sess.LastSeenAt
		if end < sess.StartAt {
			end = sess.StartAt
		}
		sess.EndAt = end
		sess.DurationSec = (end - sess.StartAt) / 1000
		sess.EndReason = EndAbnormal
	}
	ms := s.now().UnixMilli()
	sess := Session{
		ID:         uuid.NewString(),
		StartAt:    ms,
		LastSeenAt: ms,
		Version:    strings.TrimSpace(version),
	}
	s.sessions = append([]Session{sess}, s.sessions...)
	if len(s.sessions) > maxSessions {
		s.sessions = s.sessions[:maxSessions]
	}
	s.currentID = sess.ID
	return sess, s.saveLocked()
}

// Heartbeat 刷新当前会话的 LastSeenAt。
func (s *Store) Heartbeat() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.currentLocked()
	if sess == nil {
		return nil
	}
	sess.LastSeenAt = s.now().UnixMilli()
	return s.saveLocked()
}

// End 正常结束当前会话；重复调用无副作用。
func (s *Store) End() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.currentLocked()
	if sess == nil {
		return nil
	}
	ms := s.now().UnixMilli()
	sess.LastSeenAt = ms
	sess.EndAt = ms
	sess.DurationSec = (ms - sess.StartAt) / 1000
	sess.EndReason = EndNormal
	s.currentID = ""
	return s.saveLocked()
}

// Current 返回当前运行中的会话；未开始时 ok=false。
func (s *Store) Current() (Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sess := range s.sessions {
		if sess.ID == s.currentID && s.currentID != "" {
			return sess, true
		}
	}
	return Session{}, false
}

// List 返回最近 limit 条（新→旧）；limit≤0 表示全部。
func (s *Store) List(limit int) []Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := len(s.sessions)
	if limit > 0 && limit < n {
		n = limit
	}
	out := make([]Session, n)
	copy(out, s.sessions[:n])
	return out
}

// Clear 清空历史会话，保留当前运行中的会话。
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var keep []Session
	if sess := s.currentLocked(); sess != nil {
		keep = []Session{*sess}
	}
	s.sessions = keep
	return s.saveLocked()
}

func (s *Store) currentLocked() *Session {
	if s.currentID == "" {
		return nil
	}
	for i := range s.sessions {
		if s.sessions[i].ID == s.currentID {
			return &s.sessions[i]
		}
	}
	return nil
}

func (s *Store) load() error {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var list []Session
	if err := json.Unmarshal(b, &list); err != nil {
		return fmt.Errorf("解析 %s 失败: %w", sessionsFile, err)
	}
	s.sessions = list
	if len(s.sessions) > maxSessions {
		s.sessions = s.sessions[:maxSessions]
	}
	return nil
}

func (s *Store) saveLocked() error {
	if s.sessions == nil {
		s.sessions = []Session{}
	}
	b, err := json.MarshalIndent(s.sessions, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
