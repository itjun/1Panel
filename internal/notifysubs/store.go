package notifysubs

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Data 通知订阅与企微通道（与前端 settings 对齐）。
// 落盘到系统应用数据目录，重编译 / 换 webview 不会丢。
type Data struct {
	// FromDisk 本次 Get 是否来自已有文件（false = 尚未落盘，前端可把 localStorage 迁过来）
	FromDisk               bool                `json:"fromDisk"`
	NotifyEnabled          bool                `json:"notifyEnabled"`
	WecomWebhook           string              `json:"wecomWebhook"`
	WecomAlertKinds        []string            `json:"wecomAlertKinds"`
	HostResourceNotifySubs map[string][]string `json:"hostResourceNotifySubs"`
	HostAppNotifySubs      map[string][]string `json:"hostAppNotifySubs"`
}

// Store 通知订阅持久化（线程安全）。
type Store struct {
	path   string
	mu     sync.Mutex
	loaded bool // 启动时文件已存在
	data   Data
}

// NewStore 数据落盘：
//
//	Windows: %AppData%\<app>\notify_subs.json
//	macOS:   ~/Library/Application Support/<app>/notify_subs.json
//	Linux:   ~/.config/<app>/notify_subs.json
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
		path: filepath.Join(dir, "notify_subs.json"),
		data: emptyData(),
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// Get 返回副本。FromDisk 表示文件已存在（含空订阅）。
func (s *Store) Get() Data {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := cloneData(s.data)
	out.FromDisk = s.loaded
	return out
}

// Set 整份覆盖并落盘。
func (s *Store) Set(d Data) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = normalize(d)
	if err := s.saveLocked(); err != nil {
		return err
	}
	s.loaded = true
	return nil
}

func emptyData() Data {
	return Data{
		WecomAlertKinds:        []string{},
		HostResourceNotifySubs: map[string][]string{},
		HostAppNotifySubs:      map[string][]string{},
	}
}

func (s *Store) load() error {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var d Data
	if err := json.Unmarshal(b, &d); err != nil {
		return fmt.Errorf("解析 notify_subs.json 失败: %w", err)
	}
	s.data = normalize(d)
	s.loaded = true
	return nil
}

func (s *Store) saveLocked() error {
	out := cloneData(s.data)
	out.FromDisk = false // 不写入文件
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0644)
}

func normalize(d Data) Data {
	out := Data{
		NotifyEnabled:          d.NotifyEnabled,
		WecomWebhook:           strings.TrimSpace(d.WecomWebhook),
		WecomAlertKinds:        compactList(d.WecomAlertKinds),
		HostResourceNotifySubs: compactHostMap(d.HostResourceNotifySubs),
		HostAppNotifySubs:      compactAppHostMap(d.HostAppNotifySubs),
	}
	return out
}

func compactList(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

func compactHostMap(in map[string][]string) map[string][]string {
	out := map[string][]string{}
	if in == nil {
		return out
	}
	for host, list := range in {
		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}
		items := compactList(list)
		if len(items) == 0 {
			continue
		}
		out[host] = items
	}
	return out
}

// compactAppHostMap 保留空列表主机键，以便「曾配置过、当前订阅为 0」仍可展示/报警。
func compactAppHostMap(in map[string][]string) map[string][]string {
	out := map[string][]string{}
	if in == nil {
		return out
	}
	for host, list := range in {
		host = strings.TrimSpace(host)
		if host == "" {
			continue
		}
		out[host] = compactList(list)
	}
	return out
}

func cloneData(d Data) Data {
	return Data{
		FromDisk:               d.FromDisk,
		NotifyEnabled:          d.NotifyEnabled,
		WecomWebhook:           d.WecomWebhook,
		WecomAlertKinds:        append([]string{}, d.WecomAlertKinds...),
		HostResourceNotifySubs: cloneHostMap(d.HostResourceNotifySubs),
		HostAppNotifySubs:      cloneHostMap(d.HostAppNotifySubs),
	}
}

func cloneHostMap(in map[string][]string) map[string][]string {
	out := map[string][]string{}
	for k, v := range in {
		out[k] = append([]string{}, v...)
	}
	return out
}
