package notifysubs

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// 全局内容类型总闸：资源四类 + 应用探活 + 证书到期。
var knownAlertContentKinds = []string{"cpu", "mem", "disk", "load", "app", "cert"}

// 资源指标可订阅的档位，按从低到高排列；一档都没订时按只订危险档。
var alertLevelOrder = []string{"warn", "danger"}

// 通知正文可选字段。
var knownNotifyContentFields = []string{"hostName", "metric", "threshold", "value", "service"}

// Data 通知订阅与通道（与前端 settings 对齐）。
// 落盘到系统应用数据目录，重编译 / 换 webview 不会丢。
type Data struct {
	// FromDisk 本次 Get 是否来自已有文件（false = 尚未落盘，前端可把 localStorage 迁过来）
	FromDisk             bool     `json:"fromDisk"`
	NotifyEnabled        bool     `json:"notifyEnabled"`
	WecomWebhook         string   `json:"wecomWebhook"`
	SystemNotifyEnabled  bool     `json:"systemNotifyEnabled"`
	InAppNotifyEnabled   bool     `json:"inAppNotifyEnabled"`
	AlertContentKinds    []string `json:"alertContentKinds"`
	NotifyRecoverEnabled bool     `json:"notifyRecoverEnabled"`
	// AlertLevels 资源指标（cpu/mem/disk/load）订阅的档位，可同时订 warn 和 danger。
	AlertLevels            map[string][]string `json:"alertLevels"`
	NotifyContentFields    []string            `json:"notifyContentFields"`
	HostResourceNotifySubs map[string][]string `json:"hostResourceNotifySubs"`
	HostAppNotifySubs      map[string][]string `json:"hostAppNotifySubs"`
	// HostCertNotifySubs 按主机订阅证书到期。true 才发；缺省或 false 不发。
	HostCertNotifySubs map[string]bool `json:"hostCertNotifySubs"`
	// CertKindMigrated 旧配置已补过「证书」总闸。缺省时加载一次并打开，之后尊重用户关掉。
	CertKindMigrated bool `json:"certKindMigrated"`
}

// fileData 仅用于读盘：区分缺省与 false/空数组；并兼容旧字段 wecomAlertKinds。
type fileData struct {
	NotifyEnabled        bool      `json:"notifyEnabled"`
	WecomWebhook         string    `json:"wecomWebhook"`
	WecomAlertKinds      []string  `json:"wecomAlertKinds"` // 废弃：仅迁移读入
	SystemNotifyEnabled  *bool     `json:"systemNotifyEnabled"`
	InAppNotifyEnabled   *bool     `json:"inAppNotifyEnabled"`
	AlertContentKinds    *[]string `json:"alertContentKinds"`
	NotifyRecoverEnabled *bool     `json:"notifyRecoverEnabled"`
	// 旧版每类是单个字符串，新版是数组，读入时两种都认
	AlertLevels            map[string]json.RawMessage `json:"alertLevels"`
	NotifyContentFields    *[]string                  `json:"notifyContentFields"`
	HostResourceNotifySubs map[string][]string        `json:"hostResourceNotifySubs"`
	HostAppNotifySubs      map[string][]string        `json:"hostAppNotifySubs"`
	HostCertNotifySubs     map[string]bool            `json:"hostCertNotifySubs"`
	CertKindMigrated       *bool                      `json:"certKindMigrated"`
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
		SystemNotifyEnabled:    true,
		InAppNotifyEnabled:     true,
		AlertContentKinds:      append([]string{}, knownAlertContentKinds...),
		NotifyRecoverEnabled:   true,
		AlertLevels:            resolveAlertLevels(nil),
		NotifyContentFields:    append([]string{}, knownNotifyContentFields...),
		HostResourceNotifySubs: map[string][]string{},
		HostAppNotifySubs:      map[string][]string{},
		HostCertNotifySubs:     map[string]bool{},
		CertKindMigrated:       true,
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
	var raw fileData
	if err := json.Unmarshal(b, &raw); err != nil {
		return fmt.Errorf("解析 notify_subs.json 失败: %w", err)
	}
	d := dataFromFile(raw)
	needCert := raw.CertKindMigrated == nil || !*raw.CertKindMigrated
	if needCert && !containsKind(d.AlertContentKinds, "cert") {
		d.AlertContentKinds = append(d.AlertContentKinds, "cert")
	}
	s.data = normalize(d)
	s.data.CertKindMigrated = true
	s.loaded = true
	if needCert {
		if err := s.saveLocked(); err != nil {
			return err
		}
	}
	return nil
}

func containsKind(list []string, kind string) bool {
	for _, v := range list {
		if v == kind {
			return true
		}
	}
	return false
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

func dataFromFile(raw fileData) Data {
	d := Data{
		NotifyEnabled:          raw.NotifyEnabled,
		WecomWebhook:           raw.WecomWebhook,
		HostResourceNotifySubs: raw.HostResourceNotifySubs,
		HostAppNotifySubs:      raw.HostAppNotifySubs,
		HostCertNotifySubs:     raw.HostCertNotifySubs,
		AlertLevels:            alertLevelsFromFile(raw.AlertLevels),
	}
	if raw.SystemNotifyEnabled != nil {
		d.SystemNotifyEnabled = *raw.SystemNotifyEnabled
	} else {
		d.SystemNotifyEnabled = true
	}
	if raw.InAppNotifyEnabled != nil {
		d.InAppNotifyEnabled = *raw.InAppNotifyEnabled
	} else {
		d.InAppNotifyEnabled = true
	}
	if raw.NotifyRecoverEnabled != nil {
		d.NotifyRecoverEnabled = *raw.NotifyRecoverEnabled
	} else {
		d.NotifyRecoverEnabled = true
	}
	d.AlertContentKinds = resolveAlertContentKinds(raw.AlertContentKinds, raw.WecomAlertKinds)
	d.NotifyContentFields = resolveNotifyContentFields(raw.NotifyContentFields)
	return d
}

// resolveAlertContentKinds：字段缺省时用 wecomAlertKinds 迁资源类型并补 app；再缺则全开。
// 显式空数组表示用户关光，不回退。
func resolveAlertContentKinds(present *[]string, legacy []string) []string {
	if present != nil {
		return filterKnown(compactList(*present), knownAlertContentKinds)
	}
	legacyFiltered := filterKnown(compactList(legacy), []string{"cpu", "mem", "disk", "load"})
	if len(legacyFiltered) > 0 {
		return append(legacyFiltered, "app")
	}
	return append([]string{}, knownAlertContentKinds...)
}

// alertLevelsFromFile 兼容旧版单值：「warn」原义是警告起推、升到危险再推，等于两档都订。
func alertLevelsFromFile(in map[string]json.RawMessage) map[string][]string {
	out := map[string][]string{}
	for kind, raw := range in {
		var list []string
		if err := json.Unmarshal(raw, &list); err == nil {
			out[kind] = list
			continue
		}
		var single string
		if err := json.Unmarshal(raw, &single); err == nil {
			if strings.TrimSpace(single) == "warn" {
				out[kind] = []string{"warn", "danger"}
			} else {
				out[kind] = []string{strings.TrimSpace(single)}
			}
		}
	}
	return out
}

// resolveAlertLevels 每个资源指标都给出订阅档位：按从低到高去重，不认识的值丢弃，一档都没有时只订危险档。
func resolveAlertLevels(in map[string][]string) map[string][]string {
	out := map[string][]string{}
	for _, kind := range []string{"cpu", "mem", "disk", "load"} {
		picked := map[string]bool{}
		for _, v := range in[kind] {
			picked[strings.TrimSpace(v)] = true
		}
		levels := []string{}
		for _, level := range alertLevelOrder {
			if picked[level] {
				levels = append(levels, level)
			}
		}
		if len(levels) == 0 {
			levels = []string{"danger"}
		}
		out[kind] = levels
	}
	return out
}

func resolveNotifyContentFields(present *[]string) []string {
	if present != nil {
		return filterKnown(compactList(*present), knownNotifyContentFields)
	}
	return append([]string{}, knownNotifyContentFields...)
}

func filterKnown(in []string, known []string) []string {
	allow := map[string]bool{}
	for _, k := range known {
		allow[k] = true
	}
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, v := range in {
		if !allow[v] || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

func normalize(d Data) Data {
	out := Data{
		NotifyEnabled:          d.NotifyEnabled,
		WecomWebhook:           strings.TrimSpace(d.WecomWebhook),
		SystemNotifyEnabled:    d.SystemNotifyEnabled,
		InAppNotifyEnabled:     d.InAppNotifyEnabled,
		NotifyRecoverEnabled:   d.NotifyRecoverEnabled,
		AlertLevels:            resolveAlertLevels(d.AlertLevels),
		AlertContentKinds:      filterKnown(compactList(d.AlertContentKinds), knownAlertContentKinds),
		NotifyContentFields:    filterKnown(compactList(d.NotifyContentFields), knownNotifyContentFields),
		HostResourceNotifySubs: compactHostMap(d.HostResourceNotifySubs),
		HostAppNotifySubs:      compactAppHostMap(d.HostAppNotifySubs),
		HostCertNotifySubs:     compactCertHosts(d.HostCertNotifySubs),
		CertKindMigrated:       true,
	}
	return out
}

func compactCertHosts(in map[string]bool) map[string]bool {
	out := map[string]bool{}
	for host, on := range in {
		host = strings.TrimSpace(host)
		if host == "" || !on {
			continue
		}
		out[host] = true
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
		SystemNotifyEnabled:    d.SystemNotifyEnabled,
		InAppNotifyEnabled:     d.InAppNotifyEnabled,
		AlertContentKinds:      append([]string{}, d.AlertContentKinds...),
		NotifyRecoverEnabled:   d.NotifyRecoverEnabled,
		AlertLevels:            resolveAlertLevels(d.AlertLevels),
		NotifyContentFields:    append([]string{}, d.NotifyContentFields...),
		HostResourceNotifySubs: cloneHostMap(d.HostResourceNotifySubs),
		HostAppNotifySubs:      cloneHostMap(d.HostAppNotifySubs),
		HostCertNotifySubs:     cloneCertHosts(d.HostCertNotifySubs),
		CertKindMigrated:       d.CertKindMigrated,
	}
}

func cloneCertHosts(in map[string]bool) map[string]bool {
	out := map[string]bool{}
	for k, v := range in {
		if v {
			out[k] = true
		}
	}
	return out
}

func cloneHostMap(in map[string][]string) map[string][]string {
	out := map[string][]string{}
	for k, v := range in {
		out[k] = append([]string{}, v...)
	}
	return out
}
