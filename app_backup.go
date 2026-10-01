package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"diteng-pannel/internal/hosticon"
	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
	"diteng-pannel/internal/portable"
	"diteng-pannel/internal/sshconfig"
)

// Backup 跨平台主机配置迁移：主机（含密码）、分组、图标、私钥与 known_hosts
// 打包为单个 .zip，在 macOS / Windows / Linux 之间导出与恢复。
type Backup App

// maxKeyFileSize 超过该大小的 IdentityFile 视为非密钥文件，不打包
const maxKeyFileSize = 1 << 20

// BackupPreview 恢复前的预览信息
type BackupPreview struct {
	Format            string   `json:"format"` // zip / legacy-json
	Version           int      `json:"version"`
	SourceOS          string   `json:"sourceOS"`
	CreatedAt         int64    `json:"createdAt"`
	Hosts             int      `json:"hosts"`
	Groups            int      `json:"groups"`
	Keys              int      `json:"keys"`
	KnownHosts        bool     `json:"knownHosts"`
	IncludesPasswords bool     `json:"includesPasswords"`
	NewHosts          []string `json:"newHosts"`
	Conflicts         []string `json:"conflicts"`
	DroppedOptions    []string `json:"droppedOptions"`
	KeyWrites         []string `json:"keyWrites"`
	KeyRenames        []string `json:"keyRenames"`
}

// ImportResult 恢复结果统计
type ImportResult struct {
	Added          []string `json:"added"`
	Overwritten    []string `json:"overwritten"`
	Skipped        []string `json:"skipped"`
	Groups         int      `json:"groups"`
	Icons          int      `json:"icons"`
	Keys           int      `json:"keys"`
	KnownHosts     int      `json:"knownHosts"`
	DroppedOptions []string `json:"droppedOptions"`
}

// ExportBackup 导出迁移包到 path（无 .zip 后缀时自动补上），返回摘要文案
func (s *Backup) ExportBackup(path string) (string, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return "", fmt.Errorf("Panel 主机存储未初始化")
	}
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("导出路径不能为空")
	}
	if !strings.EqualFold(filepath.Ext(path), ".zip") {
		path += ".zip"
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("无法获取用户主目录: %w", err)
	}

	a.panelConfigMu.Lock()
	state := a.panelStore.Snapshot()
	root, err := sshConfigPath()
	var rawFiles []panelsync.ConfigFile
	if err == nil {
		rawFiles, err = panelsync.ReadTree(root)
	}
	a.panelConfigMu.Unlock()
	if err != nil {
		return "", err
	}

	arc := buildPortableArchive(state, home)
	exported := hostNameSet(arc.Manifest.Hosts)
	if a.hostIcons != nil {
		for _, record := range a.hostIcons.List() {
			if exported[record.Host] {
				arc.Manifest.Icons = append(arc.Manifest.Icons, record)
			}
		}
	}
	if b, err := os.ReadFile(filepath.Join(home, ".ssh", "known_hosts")); err == nil {
		arc.KnownHosts = b
	}
	for _, file := range rawFiles {
		arc.AddRawConfig(file.Path, []byte(file.Content))
	}
	if err := portable.Write(path, arc); err != nil {
		return "", err
	}
	return fmt.Sprintf("已导出 %d 台主机、%d 个分组、%d 个密钥文件到 %s（明文，含密码与私钥，请妥善保管）",
		len(arc.Manifest.Hosts), len(arc.Manifest.Groups), len(arc.Manifest.Keys), path), nil
}

// buildPortableArchive 从 Panel 模型构建迁移包：剔除 Git 托管主机，
// 私钥路径归一化为 `~/` 形式并把文件本身打包。
func buildPortableArchive(state panelstore.State, home string) *portable.Archive {
	arc := &portable.Archive{Manifest: portable.Manifest{
		CreatedAt: time.Now().Unix(),
		SourceOS:  runtime.GOOS,
		Hosts:     make([]panelstore.PanelHost, 0, len(state.Hosts)),
		Groups:    append([]panelstore.PanelGroup{}, state.Groups...),
	}}
	external := map[string]string{}
	for _, host := range state.Hosts {
		if sshconfig.IsGitHost(panelHostToLegacy(host)) {
			continue
		}
		identities := make([]string, 0, len(host.IdentityFiles))
		for _, file := range host.IdentityFiles {
			identities = append(identities, exportIdentity(arc, file, home, external))
		}
		host.IdentityFiles = identities
		if isPathLikeAgent(host.IdentityAgent) {
			if norm, inside := portable.NormalizePath(host.IdentityAgent, home); inside {
				host.IdentityAgent = norm
			}
		}
		arc.Manifest.Hosts = append(arc.Manifest.Hosts, host)
	}
	return arc
}

// exportIdentity 归一化一个 IdentityFile 并打包对应私钥（及同名 .pub）。
// external 记录 home 外私钥的目标路径 -> 源路径，用于处理同名冲突。
func exportIdentity(arc *portable.Archive, file, home string, external map[string]string) string {
	norm, inside := portable.NormalizePath(file, home)
	if norm == "" || strings.Contains(norm, "%") {
		return file
	}
	var src, target string
	if inside {
		rel, ok := portable.RelFromTilde(norm)
		if !ok {
			return norm
		}
		src, target = filepath.Join(home, filepath.FromSlash(rel)), norm
	} else {
		if !filepath.IsAbs(file) {
			return file
		}
		src = filepath.Clean(file)
		target = portable.ExternalKeyPath(filepath.Base(src))
		if prev, ok := external[target]; ok && prev != src {
			target = portable.ExternalKeyPath(filepath.Base(src) + "-" + panelstore.SHA256([]byte(src))[:8])
		}
	}
	info, err := os.Stat(src)
	if err != nil || info.IsDir() || info.Size() > maxKeyFileSize {
		if inside {
			return target
		}
		return file
	}
	content, err := os.ReadFile(src)
	if err != nil {
		if inside {
			return target
		}
		return file
	}
	rel, _ := portable.RelFromTilde(target)
	if _, err := arc.AddKey(rel, content, uint32(info.Mode().Perm())); err != nil {
		return file
	}
	if !inside {
		external[target] = src
	}
	if pub, err := os.ReadFile(src + ".pub"); err == nil {
		_, _ = arc.AddKey(rel+".pub", pub, 0644)
	}
	return target
}

func isPathLikeAgent(agent string) bool {
	agent = strings.TrimSpace(agent)
	if agent == "" || strings.EqualFold(agent, "none") || strings.EqualFold(agent, "SSH_AUTH_SOCK") || strings.HasPrefix(agent, "$") {
		return false
	}
	return true
}

// PreviewBackup 读取迁移包并给出恢复预览（不修改本机任何数据）
func (s *Backup) PreviewBackup(path string) (*BackupPreview, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return nil, fmt.Errorf("Panel 主机存储未初始化")
	}
	arc, format, err := loadBackup(path)
	if err != nil {
		return nil, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("无法获取用户主目录: %w", err)
	}
	plan, err := planRestore(arc, home, runtime.GOOS)
	if err != nil {
		return nil, err
	}
	local := hostNameSet(a.panelStore.Snapshot().Hosts)
	preview := &BackupPreview{
		Format: format, Version: arc.Manifest.Version, SourceOS: arc.Manifest.SourceOS,
		CreatedAt: arc.Manifest.CreatedAt, Hosts: len(plan.hosts), Groups: len(plan.groups),
		Keys: len(arc.Manifest.Keys), KnownHosts: len(plan.knownHosts) > 0,
		NewHosts: []string{}, Conflicts: []string{},
		DroppedOptions: append([]string{}, plan.dropped...),
		KeyWrites:      []string{}, KeyRenames: append([]string{}, plan.renames...),
	}
	for _, host := range plan.hosts {
		if host.Password != "" {
			preview.IncludesPasswords = true
		}
		if local[host.Alias] {
			preview.Conflicts = append(preview.Conflicts, host.Alias)
		} else {
			preview.NewHosts = append(preview.NewHosts, host.Alias)
		}
	}
	for _, write := range plan.keys {
		preview.KeyWrites = append(preview.KeyWrites, write.display)
	}
	return preview, nil
}

// RestoreBackup 从迁移包恢复：
//   - overwrite=false：本机已有的同名主机跳过
//   - overwrite=true：同名主机以备份为准（备份无密码时保留本机密码）
//
// 恢复前会先吸收本机 SSH 配置的外部修改并做本地快照；生成配置失败时回滚 Panel 数据。
// 恢复不做连接测试，换机后部分主机暂时不可达不影响恢复。
func (s *Backup) RestoreBackup(path string, overwrite bool) (*ImportResult, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return nil, fmt.Errorf("Panel 主机存储未初始化")
	}
	arc, _, err := loadBackup(path)
	if err != nil {
		return nil, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("无法获取用户主目录: %w", err)
	}
	plan, err := planRestore(arc, home, runtime.GOOS)
	if err != nil {
		return nil, err
	}

	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	if diff, err := a.comparePanelConfigLocked(); err != nil {
		return nil, err
	} else if diff.HasChanges() {
		imported, err := a.importPanelConfigLocked()
		if err != nil {
			return nil, err
		}
		if imported.NeedsReview {
			return nil, fmt.Errorf("本机 SSH 配置有待确认的外部修改，请先在配置中心处理后再恢复")
		}
	}
	if err := a.backupPanelStateLocked(); err != nil {
		return nil, err
	}

	res := &ImportResult{Added: []string{}, Overwritten: []string{}, Skipped: []string{}, DroppedOptions: plan.dropped}
	if res.DroppedOptions == nil {
		res.DroppedOptions = []string{}
	}
	for _, write := range plan.keys {
		if err := writeKeyFile(write.dest, write.content); err != nil {
			return nil, err
		}
		res.Keys++
	}

	current := a.panelStore.Snapshot()
	next := mergeRestore(current, plan, overwrite, res)
	if err := a.panelStore.Replace(next); err != nil {
		return nil, err
	}
	if _, err := a.generatePanelConfigLocked([]string{}, true); err != nil {
		current.ConfigStale = false
		current.LastError = ""
		if rollbackErr := a.panelStore.Replace(current); rollbackErr != nil {
			return nil, fmt.Errorf("生成 SSH 配置失败: %v；回滚主机数据也失败: %w", err, rollbackErr)
		}
		return nil, fmt.Errorf("生成 SSH 配置失败，已回滚主机数据: %w", err)
	}
	for _, alias := range res.Overwritten {
		a.sshMgr.Close(alias)
	}

	restored := map[string]bool{}
	for _, alias := range append(append([]string{}, res.Added...), res.Overwritten...) {
		restored[alias] = true
	}
	if a.hostIcons != nil {
		for _, record := range plan.icons {
			if record.OSRelease == "" || !restored[record.Host] {
				continue
			}
			if err := a.hostIcons.Put(record.Host, record.OSRelease); err != nil {
				return nil, fmt.Errorf("写入主机图标 %s 失败: %w", record.Host, err)
			}
			res.Icons++
		}
	}
	if len(plan.knownHosts) > 0 {
		added, err := mergeKnownHostsFile(filepath.Join(home, ".ssh", "known_hosts"), plan.knownHosts)
		if err != nil {
			return nil, err
		}
		res.KnownHosts = added
	}
	if err := a.syncLegacyGroupsFromPanel(a.panelStore.Snapshot()); err != nil {
		return nil, err
	}
	return res, nil
}

type keyWrite struct {
	dest    string
	content []byte
	display string
}

type restorePlan struct {
	hosts      []panelstore.PanelHost
	groups     []panelstore.PanelGroup
	icons      []hosticon.Record
	keys       []keyWrite
	renames    []string
	dropped    []string
	knownHosts []byte
}

// planRestore 计算恢复动作：私钥落盘位置（同名不同内容时另存并改写引用）、
// 适配目标系统后的主机列表。只读本机文件，不做任何写入。
func planRestore(arc *portable.Archive, home, targetOS string) (*restorePlan, error) {
	plan := &restorePlan{
		groups:     append([]panelstore.PanelGroup{}, arc.Manifest.Groups...),
		icons:      append([]hosticon.Record{}, arc.Manifest.Icons...),
		knownHosts: arc.KnownHosts,
	}
	entries := append([]portable.KeyEntry{}, arc.Manifest.Keys...)
	sort.SliceStable(entries, func(i, j int) bool {
		pi, pj := strings.HasSuffix(entries[i].RelPath, ".pub"), strings.HasSuffix(entries[j].RelPath, ".pub")
		if pi != pj {
			return !pi
		}
		return entries[i].RelPath < entries[j].RelPath
	})
	renamed := map[string]string{}
	for _, entry := range entries {
		content := arc.Keys[entry.ArchivePath]
		rel := entry.RelPath
		isPub := strings.HasSuffix(rel, ".pub")
		if isPub {
			if nr, ok := renamed[strings.TrimSuffix(rel, ".pub")]; ok {
				rel = nr + ".pub"
			}
		}
		if !portable.SafeRel(rel) {
			return nil, fmt.Errorf("备份密钥路径无效: %s", rel)
		}
		dest := filepath.Join(home, filepath.FromSlash(rel))
		if existing, err := os.ReadFile(dest); err == nil {
			if bytes.Equal(existing, content) {
				continue
			}
			if isPub {
				// 私钥未改名时保留本机公钥，公钥不影响连接
				continue
			}
			newRel := rel + ".1panel-" + panelstore.SHA256(content)[:8]
			renamed[entry.RelPath] = newRel
			plan.renames = append(plan.renames, fmt.Sprintf("~/%s -> ~/%s", rel, newRel))
			rel = newRel
			dest = filepath.Join(home, filepath.FromSlash(rel))
			if existing, err := os.ReadFile(dest); err == nil && bytes.Equal(existing, content) {
				continue
			}
		}
		plan.keys = append(plan.keys, keyWrite{dest: dest, content: content, display: "~/" + rel})
	}

	for _, host := range arc.Manifest.Hosts {
		identities := make([]string, 0, len(host.IdentityFiles))
		for _, file := range host.IdentityFiles {
			if rel, ok := portable.RelFromTilde(file); ok {
				if nr, ok := renamed[rel]; ok {
					file = "~/" + nr
				}
			}
			identities = append(identities, file)
		}
		host.IdentityFiles = identities
		host.PortForwards = append([]panelstore.PortForward(nil), host.PortForwards...)
		adapted, dropped := portable.AdaptHostForOS(host, targetOS)
		plan.dropped = append(plan.dropped, dropped...)
		plan.hosts = append(plan.hosts, adapted)
	}
	return plan, nil
}

// mergeRestore 把恢复计划合并进当前 Panel 模型，结果写入 res
func mergeRestore(current panelstore.State, plan *restorePlan, overwrite bool, res *ImportResult) panelstore.State {
	next := current
	next.Hosts = append([]panelstore.PanelHost(nil), current.Hosts...)
	if overwrite {
		next.Groups = mergePanelGroups(next.Groups, plan.groups)
	} else {
		next.Groups = appendMissingGroups(next.Groups, plan.groups)
	}
	next.Groups = sanitizeGroupParents(next.Groups)
	res.Groups = len(plan.groups)
	groupSet := make(map[string]bool, len(next.Groups))
	for _, group := range next.Groups {
		groupSet[group.ID] = true
	}

	index := make(map[string]int, len(next.Hosts))
	for i, host := range next.Hosts {
		index[host.Alias] = i
	}
	for _, incoming := range plan.hosts {
		if incoming.Alias == "" || sshconfig.IsGitHost(panelHostToLegacy(incoming)) {
			continue
		}
		if !groupSet[incoming.GroupID] {
			incoming.GroupID = ""
		}
		i, exists := index[incoming.Alias]
		switch {
		case exists && !overwrite:
			res.Skipped = append(res.Skipped, incoming.Alias)
		case exists:
			if incoming.Password == "" {
				incoming.Password = next.Hosts[i].Password
			}
			next.Hosts[i] = incoming
			res.Overwritten = append(res.Overwritten, incoming.Alias)
		default:
			index[incoming.Alias] = len(next.Hosts)
			next.Hosts = append(next.Hosts, incoming)
			res.Added = append(res.Added, incoming.Alias)
		}
	}
	next.ConfigStale = true
	next.LastError = ""
	return next
}

func appendMissingGroups(current, incoming []panelstore.PanelGroup) []panelstore.PanelGroup {
	out := append([]panelstore.PanelGroup{}, current...)
	seen := make(map[string]bool, len(current))
	for _, group := range current {
		seen[group.ID] = true
	}
	for _, group := range incoming {
		if !seen[group.ID] {
			seen[group.ID] = true
			out = append(out, group)
		}
	}
	return out
}

// sanitizeGroupParents 清除指向不存在分组或形成环的父级引用
func sanitizeGroupParents(list []panelstore.PanelGroup) []panelstore.PanelGroup {
	byID := make(map[string]int, len(list))
	for i, group := range list {
		byID[group.ID] = i
	}
	for i := range list {
		if _, ok := byID[list[i].ParentID]; !ok || list[i].ParentID == list[i].ID {
			list[i].ParentID = ""
		}
	}
	for i := range list {
		seen := map[string]bool{list[i].ID: true}
		cur := list[i].ParentID
		for cur != "" {
			if seen[cur] {
				list[i].ParentID = ""
				break
			}
			seen[cur] = true
			cur = list[byID[cur]].ParentID
		}
	}
	return list
}

// loadBackup 按文件头识别格式：zip 迁移包或旧版单 JSON 备份
func loadBackup(path string) (*portable.Archive, string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, "", fmt.Errorf("备份文件路径不能为空")
	}
	if portable.IsZip(path) {
		arc, err := portable.Read(path)
		if err != nil {
			return nil, "", err
		}
		return arc, "zip", nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, "", fmt.Errorf("读取备份文件失败: %w", err)
	}
	var data legacyBackupData
	if err := json.Unmarshal(b, &data); err != nil || data.Version != 1 {
		return nil, "", portable.ErrNotPortable
	}
	arc, err := legacyToArchive(&data)
	if err != nil {
		return nil, "", err
	}
	return arc, "legacy-json", nil
}

// legacyToArchive 把 v1 JSON 备份转换为迁移包结构。来源 home 未知，
// 绝对私钥路径按 `/.ssh/` 段猜测为 `~/.ssh/...`；旧备份不含私钥文件。
func legacyToArchive(data *legacyBackupData) (*portable.Archive, error) {
	var state *panelstore.State
	if data.PanelState != nil {
		copied := *data.PanelState
		if _, err := panelstore.MigrateLegacyGroupIDs(&copied); err != nil {
			return nil, fmt.Errorf("迁移备份分组 ID 失败: %w", err)
		}
		state = &copied
	} else {
		converted, err := legacyBackupPanelState(panelstore.State{}, data)
		if err != nil {
			return nil, err
		}
		state = converted
	}
	hosts := make([]panelstore.PanelHost, 0, len(state.Hosts))
	for _, host := range state.Hosts {
		identities := make([]string, 0, len(host.IdentityFiles))
		for _, file := range host.IdentityFiles {
			if norm, inside := portable.NormalizePath(file, ""); inside {
				file = norm
			} else if guessed, ok := portable.GuessSSHRelative(file); ok {
				file = guessed
			}
			identities = append(identities, file)
		}
		host.IdentityFiles = identities
		hosts = append(hosts, host)
	}
	return &portable.Archive{Manifest: portable.Manifest{
		Format: portable.Format, Version: 1, CreatedAt: data.ExportedAt,
		Hosts: hosts, Groups: state.Groups, Icons: data.Icons,
	}}, nil
}

func writeKeyFile(dest string, content []byte) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
		return fmt.Errorf("创建密钥目录失败: %w", err)
	}
	isPub := strings.HasSuffix(dest, ".pub")
	perm := os.FileMode(0600)
	if isPub {
		perm = 0644
	}
	if err := os.WriteFile(dest, content, perm); err != nil {
		return fmt.Errorf("写入密钥 %s 失败: %w", dest, err)
	}
	if err := os.Chmod(dest, perm); err != nil {
		return fmt.Errorf("设置密钥权限 %s 失败: %w", dest, err)
	}
	if isPub {
		return nil
	}
	return restrictKeyFile(dest)
}

func mergeKnownHostsFile(path string, incoming []byte) (int, error) {
	local, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, fmt.Errorf("读取 known_hosts 失败: %w", err)
	}
	merged, added := portable.MergeKnownHosts(local, incoming)
	if added == 0 {
		return 0, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return 0, err
	}
	if err := os.WriteFile(path, merged, 0600); err != nil {
		return 0, fmt.Errorf("写入 known_hosts 失败: %w", err)
	}
	return added, nil
}
