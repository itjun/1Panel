// Package panelstore owns the Panel runtime model.
//
// The store deliberately contains the connection fields that Panel needs to
// operate independently of OpenSSH. OpenSSH config is generated from this
// model for external tools; it is not read on every Panel connection.
package panelstore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/groupid"
)

const CurrentVersion = 1

type SSHOption struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type PortForward struct {
	Kind       string `json:"kind"`
	Bind       string `json:"bind,omitempty"`
	Port       string `json:"port,omitempty"`
	Target     string `json:"target,omitempty"`
	TargetPort string `json:"targetPort,omitempty"`
}

type PanelHost struct {
	Alias         string        `json:"alias"`
	HostName      string        `json:"hostName"`
	User          string        `json:"user"`
	Port          string        `json:"port,omitempty"`
	Password      string        `json:"password,omitempty"`
	IdentityFiles []string      `json:"identityFiles,omitempty"`
	ProxyJump     string        `json:"proxyJump,omitempty"`
	ProxyCommand  string        `json:"proxyCommand,omitempty"`
	IdentityAgent string        `json:"identityAgent,omitempty"`
	ForwardAgent  bool          `json:"forwardAgent,omitempty"`
	HostKeyAlgos  string        `json:"hostKeyAlgos,omitempty"`
	PortForwards  []PortForward `json:"portForwards,omitempty"`
	Note          string        `json:"note,omitempty"`
	GroupID       string        `json:"groupId,omitempty"`
	Order         int           `json:"order,omitempty"`
	ExtraOptions  []SSHOption   `json:"extraOptions,omitempty"`
}

type PanelGroup struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ParentID   string `json:"parentId,omitempty"`
	BoardTitle string `json:"boardTitle,omitempty"`
	Order      int    `json:"order"`
	Color      string `json:"color,omitempty"`
}

// ConfigFile stores the last known raw content of a config file. Keeping the
// raw snapshot in the Panel model lets the generator preserve comments and
// unknown directives while still rendering managed Host blocks from JSON.
type ConfigFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Mode    uint32 `json:"mode,omitempty"`
	SHA256  string `json:"sha256,omitempty"`
}

type ConfigLayout struct {
	Files          []ConfigFile `json:"files,omitempty"`
	GeneratedFiles []string     `json:"generatedFiles,omitempty"`
	ManagedHosts   []string     `json:"managedHosts,omitempty"`
	LastGenerated  int64        `json:"lastGenerated,omitempty"`
}

type State struct {
	Version      int          `json:"version"`
	Revision     uint64       `json:"revision"`
	UpdatedAt    int64        `json:"updatedAt"`
	ConfigStale  bool         `json:"configStale,omitempty"`
	LastError    string       `json:"lastError,omitempty"`
	Hosts        []PanelHost  `json:"hosts"`
	Groups       []PanelGroup `json:"groups"`
	ConfigLayout ConfigLayout `json:"configLayout,omitempty"`
	ExtraOptions []SSHOption  `json:"extraOptions,omitempty"`
}

// PanelState is the public domain name used by the JSON-first architecture.
// Keep State as the shorter internal spelling for compatibility with the
// existing Wails bindings and callers.
type PanelState = State

type Store struct {
	path string
	mu   sync.RWMutex
	data State
}

// PanelStore is the public domain name for the atomic JSON store.
type PanelStore = Store

func NewStore(appName string) (*Store, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(base, appName)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("创建 Panel 数据目录失败: %w", err)
	}
	s := &Store{path: filepath.Join(dir, "panel.json"), data: emptyState()}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func NewStoreAt(path string) (*Store, error) {
	path = filepath.Clean(path)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	s := &Store{path: path, data: emptyState()}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func emptyState() State {
	return State{Version: CurrentVersion, Hosts: []PanelHost{}, Groups: []PanelGroup{}}
}

func (s *Store) Path() string { return s.path }

func (s *Store) Snapshot() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneState(s.data)
}

func (s *Store) Replace(next State) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := normalizeAndValidate(&next); err != nil {
		return err
	}
	next.Revision = s.data.Revision + 1
	next.UpdatedAt = time.Now().Unix()
	if err := saveFile(s.path, next); err != nil {
		return err
	}
	s.data = cloneState(next)
	return nil
}

func (s *Store) Update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.data)
	if err := fn(&next); err != nil {
		return err
	}
	if err := normalizeAndValidate(&next); err != nil {
		return err
	}
	next.Revision = s.data.Revision + 1
	next.UpdatedAt = time.Now().Unix()
	if err := saveFile(s.path, next); err != nil {
		return err
	}
	s.data = cloneState(next)
	return nil
}

func (s *Store) GetHost(alias string) (PanelHost, bool) {
	alias = strings.TrimSpace(alias)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, h := range s.data.Hosts {
		if h.Alias == alias {
			return cloneHost(h), true
		}
	}
	return PanelHost{}, false
}

func (s *Store) ListHosts() []PanelHost {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]PanelHost, len(s.data.Hosts))
	for i, h := range s.data.Hosts {
		out[i] = cloneHost(h)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Alias < out[j].Alias })
	return out
}

// LoadStateFile reads and validates a standalone Panel JSON snapshot. It is
// used by the migration repair path to recover UI metadata from private
// backups created before a failed import or generation.
func LoadStateFile(path string) (State, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return State{}, err
	}
	var state State
	if _, err := decodeState(b, &state); err != nil {
		return State{}, err
	}
	return state, nil
}

func (s *Store) load() error {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("读取 panel.json 失败: %w", err)
	}
	var state State
	migrated, err := decodeState(b, &state)
	if err != nil {
		// A malformed file is quarantined instead of being overwritten. The
		// latest generated backup is then used when available, so a damaged
		// JSON file cannot silently discard saved passwords and UI metadata.
		_ = quarantineCorruptFile(s.path)
		if recovered, ok := loadLatestBackup(filepath.Dir(s.path)); ok {
			s.data = recovered
			return nil
		}
		return nil
	}
	if migrated {
		if err := saveFile(s.path, state); err != nil {
			return fmt.Errorf("迁移 panel.json 分组 ID 失败: %w", err)
		}
	}
	s.data = cloneState(state)
	return nil
}

func decodeState(b []byte, state *State) (bool, error) {
	if err := json.Unmarshal(b, state); err != nil {
		return false, fmt.Errorf("解析 panel.json 失败: %w", err)
	}
	if state.Version == 0 {
		state.Version = CurrentVersion
	}
	if state.Version > CurrentVersion {
		return false, fmt.Errorf("panel.json 版本过高: %d（当前支持 %d）", state.Version, CurrentVersion)
	}
	migrated, err := MigrateLegacyGroupIDs(state)
	if err != nil {
		return false, err
	}
	if err := normalizeAndValidate(state); err != nil {
		return false, err
	}
	return migrated, nil
}

func quarantineCorruptFile(path string) error {
	stamp := time.Now().Format("20060102-150405")
	dst := path + ".corrupt." + stamp
	for i := 1; ; i++ {
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			return os.Rename(path, dst)
		}
		dst = fmt.Sprintf("%s.%d", path+".corrupt."+stamp, i)
	}
}

func loadLatestBackup(base string) (State, bool) {
	entries, err := os.ReadDir(filepath.Join(base, "backups"))
	if err != nil {
		return State{}, false
	}
	for i := len(entries) - 1; i >= 0; i-- {
		entry := entries[i]
		if !entry.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(base, "backups", entry.Name(), "panel.json"))
		if err != nil {
			continue
		}
		var state State
		if _, err := decodeState(b, &state); err == nil {
			return state, true
		}
	}
	return State{}, false
}

// MigrateLegacyGroupIDs upgrades the pre-JSON-first group identity model.
// Older Panel data used opaque IDs such as "g_mu4cxasx" while keeping the
// user-facing group name separately. The current contract makes that name the
// ID, so migrate all references and generated config filenames together before
// strict validation runs. The raw file content and hashes remain unchanged.
func MigrateLegacyGroupIDs(state *State) (bool, error) {
	oldToNew := make(map[string]string)
	seen := make(map[string]struct{}, len(state.Groups))
	migrated := false
	for i := range state.Groups {
		group := &state.Groups[i]
		oldID := strings.TrimSpace(group.ID)
		name := strings.TrimSpace(group.Name)
		if name == "" {
			name = oldID
		}
		if oldID == "" {
			return false, fmt.Errorf("Panel 分组 ID 不能为空")
		}
		if oldID != name {
			if err := groupid.Validate(name); err != nil {
				return false, fmt.Errorf("旧分组 %s 无法迁移为 %s: %w", oldID, name, err)
			}
			if previous, ok := oldToNew[oldID]; ok && previous != name {
				return false, fmt.Errorf("旧分组 ID 重复且指向不同名称: %s", oldID)
			}
			oldToNew[oldID] = name
			group.ID = name
			group.Name = name
			migrated = true
		} else {
			group.ID = oldID
			group.Name = name
		}
		if _, ok := seen[group.ID]; ok {
			return false, fmt.Errorf("Panel 分组名称重复: %s", group.Name)
		}
		seen[group.ID] = struct{}{}
	}
	if !migrated {
		return false, nil
	}
	for i := range state.Groups {
		if next, ok := oldToNew[strings.TrimSpace(state.Groups[i].ParentID)]; ok {
			state.Groups[i].ParentID = next
		}
	}
	for i := range state.Hosts {
		if next, ok := oldToNew[strings.TrimSpace(state.Hosts[i].GroupID)]; ok {
			state.Hosts[i].GroupID = next
		}
	}
	for i := range state.ConfigLayout.Files {
		state.ConfigLayout.Files[i].Path = migrateConfigPath(state.ConfigLayout.Files[i].Path, oldToNew)
	}
	for i := range state.ConfigLayout.GeneratedFiles {
		state.ConfigLayout.GeneratedFiles[i] = migrateConfigPath(state.ConfigLayout.GeneratedFiles[i], oldToNew)
	}
	return true, nil
}

func migrateConfigPath(path string, oldToNew map[string]string) string {
	const prefix = "config.d/"
	const suffix = ".conf"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return path
	}
	base := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if next, ok := oldToNew[base]; ok {
		return prefix + next + suffix
	}
	return path
}

func normalizeAndValidate(state *State) error {
	if state.Version == 0 {
		state.Version = CurrentVersion
	}
	if state.Version != CurrentVersion {
		return fmt.Errorf("不支持的 Panel 数据版本: %d", state.Version)
	}
	seen := make(map[string]struct{}, len(state.Hosts))
	for i := range state.Hosts {
		h := &state.Hosts[i]
		h.Alias = strings.TrimSpace(h.Alias)
		h.HostName = strings.TrimSpace(h.HostName)
		h.User = strings.TrimSpace(h.User)
		h.Port = strings.TrimSpace(h.Port)
		h.GroupID = strings.TrimSpace(h.GroupID)
		if h.Alias == "" {
			return fmt.Errorf("Panel 主机别名不能为空")
		}
		if strings.ContainsAny(h.Alias, " \t\r\n*?#") {
			return fmt.Errorf("Panel 主机别名无效: %s", h.Alias)
		}
		for label, value := range map[string]string{
			"HostName": h.HostName, "User": h.User, "Port": h.Port,
			"ProxyJump": h.ProxyJump, "ProxyCommand": h.ProxyCommand,
			"IdentityAgent": h.IdentityAgent, "HostKeyAlgorithms": h.HostKeyAlgos,
			"Note": h.Note,
		} {
			if strings.ContainsAny(value, "\r\n") {
				return fmt.Errorf("主机 %s 的 %s 不能包含换行符", h.Alias, label)
			}
		}
		for _, identity := range h.IdentityFiles {
			if strings.ContainsAny(identity, "\r\n") {
				return fmt.Errorf("主机 %s 的 IdentityFile 不能包含换行符", h.Alias)
			}
		}
		for _, option := range h.ExtraOptions {
			if strings.ContainsAny(option.Key+option.Value, "\r\n") {
				return fmt.Errorf("主机 %s 的额外 SSH 选项不能包含换行符", h.Alias)
			}
		}
		for _, forward := range h.PortForwards {
			if strings.ContainsAny(forward.Kind+forward.Bind+forward.Port+forward.Target+forward.TargetPort, "\r\n") {
				return fmt.Errorf("主机 %s 的端口转发不能包含换行符", h.Alias)
			}
		}
		if _, ok := seen[h.Alias]; ok {
			return fmt.Errorf("Panel 主机别名重复: %s", h.Alias)
		}
		seen[h.Alias] = struct{}{}
		if h.Port == "" {
			h.Port = "22"
		}
		if h.IdentityFiles == nil {
			h.IdentityFiles = []string{}
		}
		if h.ExtraOptions == nil {
			h.ExtraOptions = []SSHOption{}
		}
	}
	for _, option := range state.ExtraOptions {
		if strings.ContainsAny(option.Key+option.Value, "\r\n") {
			return fmt.Errorf("全局额外 SSH 选项不能包含换行符")
		}
	}
	groups := make(map[string]struct{}, len(state.Groups))
	for i := range state.Groups {
		g := &state.Groups[i]
		g.ID = strings.TrimSpace(g.ID)
		g.Name = strings.TrimSpace(g.Name)
		if g.ID == "" {
			return fmt.Errorf("Panel 分组 ID 不能为空")
		}
		if g.Name == "" {
			g.Name = g.ID
		}
		if g.ID != g.Name {
			return fmt.Errorf("Panel 分组 ID 必须与分组名称一致: %s", g.ID)
		}
		if err := groupid.Validate(g.ID); err != nil {
			return err
		}
		if _, ok := groups[g.ID]; ok {
			return fmt.Errorf("Panel 分组 ID 重复: %s", g.ID)
		}
		groups[g.ID] = struct{}{}
	}
	for _, h := range state.Hosts {
		if h.GroupID != "" {
			if _, ok := groups[h.GroupID]; !ok {
				return fmt.Errorf("主机 %s 引用了不存在的分组 %s", h.Alias, h.GroupID)
			}
		}
	}
	return nil
}

func saveFile(path string, state State) error {
	b, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化 panel.json 失败: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".panel-*.tmp")
	if err != nil {
		return fmt.Errorf("创建 panel.json 临时文件失败: %w", err)
	}
	tmpName := tmp.Name()
	clean := true
	defer func() {
		if clean {
			_ = os.Remove(tmpName)
		}
	}()
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("写入 panel.json 临时文件失败: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("同步 panel.json 临时文件失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("替换 panel.json 失败: %w", err)
	}
	clean = false
	return nil
}

func SHA256(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

func cloneState(in State) State {
	out := in
	out.Hosts = make([]PanelHost, len(in.Hosts))
	for i, h := range in.Hosts {
		out.Hosts[i] = cloneHost(h)
	}
	out.Groups = append([]PanelGroup(nil), in.Groups...)
	out.ExtraOptions = append([]SSHOption(nil), in.ExtraOptions...)
	out.ConfigLayout.Files = append([]ConfigFile(nil), in.ConfigLayout.Files...)
	out.ConfigLayout.GeneratedFiles = append([]string(nil), in.ConfigLayout.GeneratedFiles...)
	out.ConfigLayout.ManagedHosts = append([]string(nil), in.ConfigLayout.ManagedHosts...)
	for i := range out.ConfigLayout.Files {
		out.ConfigLayout.Files[i].Content = in.ConfigLayout.Files[i].Content
	}
	return out
}

func cloneHost(in PanelHost) PanelHost {
	out := in
	out.IdentityFiles = append([]string(nil), in.IdentityFiles...)
	out.PortForwards = append([]PortForward(nil), in.PortForwards...)
	out.ExtraOptions = append([]SSHOption(nil), in.ExtraOptions...)
	return out
}
