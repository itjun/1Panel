package app

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"diteng-pannel/internal/appbackup"
	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
)

// ApplicationBackup describes a full snapshot without exposing its secrets.
type ApplicationBackup struct {
	Path        string `json:"path"`
	Name        string `json:"name"`
	CreatedAt   int64  `json:"createdAt"`
	SourceOS    string `json:"sourceOS"`
	Hosts       int    `json:"hosts"`
	Groups      int    `json:"groups"`
	DataFiles   int    `json:"dataFiles"`
	SSHFiles    int    `json:"sshFiles"`
	Preferences int    `json:"preferences"`
	Size        int64  `json:"size"`
	Fingerprint string `json:"fingerprint"`
}

type ApplicationPreferences struct {
	ID     string            `json:"id"`
	Values map[string]string `json:"values"`
}

func applicationDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "ServerPanel"), nil
}

func (s *Backup) applicationDataRoot() (string, error) {
	if s.panelStore == nil {
		return "", fmt.Errorf("应用数据未初始化")
	}
	return filepath.Dir(s.panelStore.Path()), nil
}

func applicationBackupSummary(path string, snap *appbackup.Snapshot, fingerprint string) ApplicationBackup {
	m := snap.Manifest
	b := ApplicationBackup{Path: path, Name: filepath.Base(path), CreatedAt: m.CreatedAt, SourceOS: m.SourceOS, Hosts: m.Hosts, Groups: m.Groups, Preferences: len(m.Preferences), Fingerprint: fingerprint}
	for _, e := range m.Entries {
		if strings.HasPrefix(e.Path, "data/") {
			b.DataFiles++
		} else {
			b.SSHFiles++
		}
	}
	if info, err := os.Stat(path); err == nil {
		b.Size = info.Size()
	}
	return b
}

func collectApplicationSnapshot(root, home string, preferences map[string]string) (*appbackup.Snapshot, error) {
	s := &appbackup.Snapshot{Manifest: appbackup.Manifest{Format: appbackup.Format, Version: 1, CreatedAt: time.Now().UnixMilli(), SourceOS: runtime.GOOS, SourceHome: home, SourceDataDir: root, Preferences: preferences, Relocations: map[string]string{}}}
	if preferences == nil {
		return nil, fmt.Errorf("无法读取应用偏好，已取消备份")
	}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == root {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		if appbackup.Excluded(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			return fmt.Errorf("应用数据包含非普通文件: %s", rel)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if strings.EqualFold(filepath.Ext(p), ".json") && !json.Valid(b) {
			return fmt.Errorf("应用数据正在写入或内容无效，请重试: %s", rel)
		}
		return s.Add("data/"+filepath.ToSlash(rel), b, 0600, strings.EqualFold(filepath.Ext(p), ".json"))
	})
	if err != nil {
		return nil, err
	}
	var state struct {
		Hosts []struct {
			IdentityFiles []string               `json:"identityFiles"`
			ExtraOptions  []panelstore.SSHOption `json:"extraOptions"`
		} `json:"hosts"`
		Groups       []json.RawMessage      `json:"groups"`
		ExtraOptions []panelstore.SSHOption `json:"extraOptions"`
	}
	if err := json.Unmarshal(s.Files["data/panel.json"], &state); err != nil {
		return nil, fmt.Errorf("读取主机数据失败: %w", err)
	}
	s.Manifest.Hosts, s.Manifest.Groups = len(state.Hosts), len(state.Groups)
	addSSH := func(original string, text, required bool) error {
		p := original
		if strings.HasPrefix(p, "~/") {
			p = filepath.Join(home, p[2:])
		}
		if !filepath.IsAbs(p) {
			p = filepath.Join(home, p)
		}
		b, err := os.ReadFile(p)
		if os.IsNotExist(err) && !required {
			return nil
		}
		if err != nil {
			return fmt.Errorf("无法备份 SSH 文件 %s: %w", original, err)
		}
		rel, err := filepath.Rel(filepath.Join(home, ".ssh"), p)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			if text {
				return fmt.Errorf("SSH 引用文件不在 ~/.ssh 内，无法生成可完整恢复的备份：%s", p)
			}
			folder := "1panel-keys"
			rel = filepath.Join(folder, appbackup.Hash([]byte(p))[:12]+"-"+filepath.Base(p))
			if _, exists := s.Manifest.Relocations[p]; !exists {
				s.Manifest.Relocations[p] = filepath.Join(home, ".ssh", rel)
			}
		}
		if relocated, ok := s.Manifest.Relocations[p]; ok {
			rel, err = filepath.Rel(filepath.Join(home, ".ssh"), relocated)
			if err != nil {
				return err
			}
		}
		name := "ssh/" + filepath.ToSlash(rel)
		if _, ok := s.Files[name]; ok {
			return nil
		}
		return s.Add(name, b, 0600, text)
	}
	config := filepath.Join(home, ".ssh", "config")
	if _, err := os.Stat(config); err == nil {
		tree, err := panelsync.ReadTree(config)
		if err != nil {
			return nil, err
		}
		for _, file := range tree {
			p := file.Path
			if !filepath.IsAbs(p) {
				p = filepath.Join(home, ".ssh", p)
			}
			if err := addSSH(p, true, true); err != nil {
				return nil, err
			}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	for _, h := range state.Hosts {
		for _, key := range h.IdentityFiles {
			if key == "" || strings.EqualFold(key, "none") {
				continue
			}
			if err := addSSH(key, false, true); err != nil {
				return nil, err
			}
			original := key
			if strings.HasPrefix(original, "~/") {
				original = filepath.Join(home, original[2:])
			}
			if !filepath.IsAbs(original) {
				original = filepath.Join(home, original)
			}
			for _, suffix := range []string{".pub", "-cert.pub"} {
				if relocated, ok := s.Manifest.Relocations[original]; ok {
					s.Manifest.Relocations[original+suffix] = relocated + suffix
				}
				if err := addSSH(original+suffix, false, false); err != nil {
					return nil, err
				}
			}
		}
		state.ExtraOptions = append(state.ExtraOptions, h.ExtraOptions...)
	}
	for _, option := range state.ExtraOptions {
		switch strings.ToLower(option.Key) {
		case "certificatefile", "revokedhostkeys", "userknownhostsfile":
			if strings.EqualFold(strings.TrimSpace(option.Value), "none") {
				continue
			}
			for _, file := range strings.Fields(option.Value) {
				if err := addSSH(file, false, true); err != nil {
					return nil, err
				}
			}
		}
	}
	for _, name := range []string{"known_hosts", "known_hosts2", "id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"} {
		p := filepath.Join(home, ".ssh", name)
		if err := addSSH(p, false, false); err != nil {
			return nil, err
		}
		if strings.HasPrefix(name, "id_") {
			for _, suffix := range []string{".pub", "-cert.pub"} {
				if err := addSSH(p+suffix, false, false); err != nil {
					return nil, err
				}
			}
		}
	}
	return s, nil
}

func (s *Backup) snapshotApplication(preferences map[string]string) (*appbackup.Snapshot, string, error) {
	root, err := s.applicationDataRoot()
	if err != nil {
		return nil, "", err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, "", err
	}
	s.panelConfigMu.Lock()
	defer s.panelConfigMu.Unlock()
	snap, err := collectApplicationSnapshot(root, home, preferences)
	return snap, root, err
}

func saveApplicationSnapshot(root, prefix string, snap *appbackup.Snapshot) (ApplicationBackup, error) {
	p := filepath.Join(root, "application-backups", prefix+time.Now().Format("20060102-150405.000000000")+".zip")
	if err := appbackup.Write(p, snap); err != nil {
		return ApplicationBackup{}, err
	}
	return applicationBackupSummary(p, snap, ""), nil
}

// PickAndBackupApplicationData saves a complete local snapshot and an export.
func (s *Backup) PickAndBackupApplicationData(preferences map[string]string) (*ApplicationBackup, error) {
	if s.app == nil {
		return nil, fmt.Errorf("应用未初始化")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	d := s.app.Dialog.SaveFile().SetMessage("选择应用数据备份的保存位置").SetDirectory(home).SetFilename("1panel-data-"+time.Now().Format("20060102-150405")+".zip").SetButtonText("备份").CanCreateDirectories(true).AddFilter("1Panel 应用数据备份 (*.zip)", "*.zip")
	if s.mainWindow != nil {
		d.AttachToWindow(s.mainWindow)
	}
	dst, err := d.PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(dst) == "" {
		return nil, nil
	}
	return s.BackupApplicationData(dst, preferences)
}

func (s *Backup) BackupApplicationData(dst string, preferences map[string]string) (*ApplicationBackup, error) {
	s.applicationDataMu.Lock()
	defer s.applicationDataMu.Unlock()
	if strings.TrimSpace(dst) == "" {
		return nil, fmt.Errorf("请选择备份保存位置")
	}
	if !strings.EqualFold(filepath.Ext(dst), ".zip") {
		dst += ".zip"
	}
	snap, root, err := s.snapshotApplication(preferences)
	if err != nil {
		return nil, err
	}
	if err := appbackup.Write(dst, snap); err != nil {
		return nil, err
	}
	local, err := saveApplicationSnapshot(root, "1panel-data-", snap)
	if err != nil {
		return nil, fmt.Errorf("已保存到 %s，但无法保存本地副本: %w", dst, err)
	}
	return &local, nil
}

func (s *Backup) ListApplicationBackups() ([]ApplicationBackup, error) {
	root, err := s.applicationDataRoot()
	if err != nil {
		return nil, err
	}
	list, err := os.ReadDir(filepath.Join(root, "application-backups"))
	if os.IsNotExist(err) {
		return []ApplicationBackup{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []ApplicationBackup{}
	for _, e := range list {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".zip") {
			continue
		}
		p := filepath.Join(root, "application-backups", e.Name())
		snap, err := appbackup.Inspect(p)
		if err != nil {
			return nil, fmt.Errorf("无法读取备份 %s: %w", e.Name(), err)
		}
		out = append(out, applicationBackupSummary(p, snap, ""))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out, nil
}

func (s *Backup) PickApplicationBackup() (string, error) {
	if s.app == nil {
		return "", fmt.Errorf("应用未初始化")
	}
	d := s.app.Dialog.OpenFile().SetTitle("选择应用数据备份").CanChooseFiles(true).CanChooseDirectories(false).AddFilter("1Panel 应用数据备份 (*.zip)", "*.zip")
	if s.mainWindow != nil {
		d.AttachToWindow(s.mainWindow)
	}
	return d.PromptForSingleSelection()
}

func (s *Backup) PreviewApplicationBackup(path string) (*ApplicationBackup, error) {
	snap, hash, err := appbackup.Read(path)
	if err != nil {
		return nil, err
	}
	b := applicationBackupSummary(path, snap, hash)
	return &b, nil
}

// RestoreApplicationData stages an already-previewed snapshot. Applying it is
// deferred until the next process owns the single-instance lock, before stores
// and background writers are constructed.
func (s *Backup) RestoreApplicationData(path, fingerprint string, preferences map[string]string) error {
	s.applicationDataMu.Lock()
	defer s.applicationDataMu.Unlock()
	snap, hash, err := appbackup.Read(path)
	if err != nil {
		return err
	}
	if fingerprint == "" || hash != fingerprint {
		return fmt.Errorf("备份文件已变化，请重新查看内容后恢复")
	}
	current, root, err := s.snapshotApplication(preferences)
	if err != nil {
		return err
	}
	if _, err := saveApplicationSnapshot(root, "恢复前-", current); err != nil {
		return fmt.Errorf("无法备份当前数据，已取消恢复: %w", err)
	}
	pending := filepath.Join(root, ".application-restore", "pending.zip")
	if err := appbackup.Write(pending, snap); err != nil {
		return err
	}
	if s.app != nil {
		time.AfterFunc(350*time.Millisecond, func() { (*App)(s).restartApp() })
	}
	return nil
}

func (s *Backup) RestoredApplicationPreferences() (*ApplicationPreferences, error) {
	root, err := s.applicationDataRoot()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(root, ".application-restore", "preferences.json"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var p ApplicationPreferences
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Backup) AcknowledgeApplicationPreferences(id string) error {
	p, err := s.RestoredApplicationPreferences()
	if err != nil {
		return err
	}
	if p == nil {
		return nil
	}
	if p.ID != id {
		return fmt.Errorf("恢复状态已变化")
	}
	root, err := s.applicationDataRoot()
	if err != nil {
		return err
	}
	return os.Remove(filepath.Join(root, ".application-restore", "preferences.json"))
}

func (s *Backup) ApplicationRestoreError() string { return s.applicationRestoreError }

func applyPendingApplicationRestore() error {
	root, err := applicationDataDir()
	if err != nil {
		return err
	}
	pending := filepath.Join(root, ".application-restore", "pending.zip")
	if _, err := os.Stat(pending); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	snap, _, err := appbackup.Read(pending)
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	if err := appbackup.Apply(snap, root, home); err != nil {
		return err
	}
	return os.Remove(pending)
}
