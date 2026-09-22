package certnotify

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Sent 某一天里某个通知已经送到的频道。没送成的下一次轮询只补那一路。
type Sent struct {
	Key     string `json:"key"`
	Desktop bool   `json:"desktop"`
	Wecom   bool   `json:"wecom"`
}

// Cursor 某台主机已经处理过的扫描日，以及仍在催的域名。
// PartialDate 有值表示这一天还有频道没送完，AppliedDate 先不动。
type Cursor struct {
	AppliedDate string   `json:"appliedDate"`
	Nagging     []string `json:"nagging"`
	PartialDate string   `json:"partialDate"`
	Sent        []Sent   `json:"sent"`
}

type fileState struct {
	Hosts map[string]Cursor `json:"hosts"`
}

// Store 证书告警去重游标（本机应用数据目录）。
type Store struct {
	path  string
	mu    sync.Mutex
	hosts map[string]Cursor
}

// NewStore 数据落盘：
//
//	Windows: %AppData%\<app>\cert_notify_state.json
//	macOS:   ~/Library/Application Support/<app>/cert_notify_state.json
//	Linux:   ~/.config/<app>/cert_notify_state.json
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
		path:  filepath.Join(dir, "cert_notify_state.json"),
		hosts: map[string]Cursor{},
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// Get 返回该主机的游标副本。没有记录时 AppliedDate 为空。
func (s *Store) Get(host string) Cursor {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneCursor(s.hosts[strings.TrimSpace(host)])
}

// Commit 覆盖该主机的游标并落盘。
func (s *Store) Commit(host string, c Cursor) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return fmt.Errorf("主机名为空")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hosts[host] = normalizeCursor(c)
	return s.saveLocked()
}

// Rename 主机改名时把游标带走。目标名已有游标时合并，不丢掉旧名单。
func (s *Store) Rename(from, to string) error {
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if from == "" || to == "" || from == to {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.hosts[from]
	if !ok {
		return nil
	}
	delete(s.hosts, from)
	if dst, exists := s.hosts[to]; exists {
		s.hosts[to] = mergeCursor(dst, cur)
	} else {
		s.hosts[to] = cur
	}
	return s.saveLocked()
}

func mergeCursor(dst, src Cursor) Cursor {
	out := dst
	if src.AppliedDate > out.AppliedDate {
		out.AppliedDate = src.AppliedDate
	}
	out.Nagging = uniqueStrings(append(append([]string{}, dst.Nagging...), src.Nagging...))
	switch {
	case src.PartialDate > dst.PartialDate:
		out.PartialDate = src.PartialDate
		out.Sent = cloneSent(src.Sent)
	case src.PartialDate == dst.PartialDate && src.PartialDate != "":
		out.PartialDate = dst.PartialDate
		out.Sent = mergeSent(dst.Sent, src.Sent)
	default:
		out.PartialDate = dst.PartialDate
		out.Sent = cloneSent(dst.Sent)
	}
	return normalizeCursor(out)
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
		return fmt.Errorf("解析 cert_notify_state.json 失败: %w", err)
	}
	hosts := map[string]Cursor{}
	for host, c := range raw.Hosts {
		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}
		hosts[host] = normalizeCursor(c)
	}
	s.hosts = hosts
	return nil
}

func (s *Store) saveLocked() error {
	out := fileState{Hosts: map[string]Cursor{}}
	for host, c := range s.hosts {
		out.Hosts[host] = cloneCursor(c)
	}
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0644)
}

func normalizeCursor(c Cursor) Cursor {
	return Cursor{
		AppliedDate: strings.TrimSpace(c.AppliedDate),
		Nagging:     uniqueStrings(c.Nagging),
		PartialDate: strings.TrimSpace(c.PartialDate),
		Sent:        normalizeSent(c.Sent),
	}
}

func cloneCursor(c Cursor) Cursor {
	return Cursor{
		AppliedDate: c.AppliedDate,
		Nagging:     append([]string{}, c.Nagging...),
		PartialDate: c.PartialDate,
		Sent:        cloneSent(c.Sent),
	}
}

func cloneSent(in []Sent) []Sent {
	if len(in) == 0 {
		return []Sent{}
	}
	return append([]Sent{}, in...)
}

func normalizeSent(in []Sent) []Sent {
	if len(in) == 0 {
		return []Sent{}
	}
	return mergeSent(in, nil)
}

func mergeSent(a, b []Sent) []Sent {
	by := map[string]Sent{}
	order := make([]string, 0)
	for _, s := range append(append([]Sent{}, a...), b...) {
		s.Key = strings.TrimSpace(s.Key)
		if s.Key == "" {
			continue
		}
		old, ok := by[s.Key]
		if !ok {
			order = append(order, s.Key)
			old.Key = s.Key
		}
		old.Desktop = old.Desktop || s.Desktop
		old.Wecom = old.Wecom || s.Wecom
		by[s.Key] = old
	}
	sort.Strings(order)
	out := make([]Sent, 0, len(order))
	for _, key := range order {
		out = append(out, by[key])
	}
	return out
}
