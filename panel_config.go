package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
	"diteng-pannel/internal/sshd"
)

// PanelConfig is the JSON/config synchronization service. It is deliberately
// separate from Hosts: Hosts owns the ordinary host UI, while this service is
// the explicit boundary between Panel JSON and the external OpenSSH tree.
type PanelConfig App

type PanelConfigStatus struct {
	PanelPath     string               `json:"panelPath"`
	SSHConfigPath string               `json:"sshConfigPath"`
	Revision      uint64               `json:"revision"`
	ConfigStale   bool                 `json:"configStale"`
	Drift         bool                 `json:"drift"`
	NeedsReview   bool                 `json:"needsReview"`
	Diff          panelsync.ConfigDiff `json:"diff"`
}

// ConfigDraft is used by the existing text editor. The editor submits the
// complete config tree, which is parsed into Panel JSON and then regenerated;
// it never becomes a second runtime source of truth.
type ConfigDraft struct {
	Files []panelsync.ConfigFile `json:"files"`
}

func (s *PanelConfig) GetPanelState() (panelstore.State, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return panelstore.State{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	return a.panelStore.Snapshot(), nil
}

func (s *PanelConfig) GetConfigFiles() ([]panelsync.ConfigFile, error) {
	path, err := sshConfigPath()
	if err != nil {
		return nil, err
	}
	return panelsync.ReadTree(path)
}

func (s *PanelConfig) GetConfigText() (string, error) {
	path, err := sshConfigPath()
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("读取 SSH 配置失败: %w", err)
	}
	return string(b), nil
}

func (s *PanelConfig) CompareConfig() (panelsync.ConfigDiff, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return panelsync.ConfigDiff{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	return a.comparePanelConfigLocked()
}

func (s *PanelConfig) GetStatus() (PanelConfigStatus, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return PanelConfigStatus{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	diff, err := a.comparePanelConfigLocked()
	if err != nil {
		return PanelConfigStatus{}, err
	}
	configPath, err := sshConfigPath()
	if err != nil {
		return PanelConfigStatus{}, err
	}
	state := a.panelStore.Snapshot()
	return PanelConfigStatus{
		PanelPath:     a.panelStore.Path(),
		SSHConfigPath: configPath,
		Revision:      state.Revision,
		ConfigStale:   state.ConfigStale,
		Drift:         diff.HasChanges(),
		NeedsReview:   len(diff.Conflicts) > 0,
		Diff:          diff,
	}, nil
}

// ImportConfig imports non-conflicting external edits into Panel JSON. It
// does not immediately rewrite the config: the next Panel save/generation is
// the point at which the JSON model becomes the generated artifact again.
func (s *PanelConfig) ImportConfig() (panelsync.ImportResult, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return panelsync.ImportResult{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	return a.importPanelConfigLocked()
}

// ConfirmConfigImport explicitly accepts an ambiguous external config diff.
// The accepted tree becomes the new JSON snapshot, but remains config-stale
// until the normal generation path re-tests every host and runs ssh -G.
func (s *PanelConfig) ConfirmConfigImport() (panelsync.ImportResult, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return panelsync.ImportResult{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	path, err := sshConfigPath()
	if err != nil {
		return panelsync.ImportResult{}, err
	}
	result, err := panelsync.Import(context.Background(), path, a.panelStore.Snapshot())
	if err != nil {
		return panelsync.ImportResult{}, err
	}
	if !result.NeedsReview {
		return a.importPanelConfigLocked()
	}
	if result.Diff.Imported == nil {
		return result, fmt.Errorf("配置差异没有可导入的 Panel 模型")
	}
	if err := a.backupPanelStateLocked(); err != nil {
		return panelsync.ImportResult{}, err
	}
	next := *result.Diff.Imported
	next.ConfigStale = true
	next.LastError = "外部 SSH 配置已确认导入，请重新生成配置"
	if err := a.panelStore.Replace(next); err != nil {
		return panelsync.ImportResult{}, err
	}
	if err := a.syncLegacyGroupsFromPanel(next); err != nil {
		return panelsync.ImportResult{}, err
	}
	result.State = next
	result.NeedsReview = false
	return result, nil
}

// SaveState replaces the JSON draft and runs the same validation, connectivity
// and ssh -G checks as a normal generation. A failed generation leaves the
// JSON saved and marks it config-stale for a later retry.
func (s *PanelConfig) SaveState(state panelstore.State) error {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	if err := a.backupPanelStateLocked(); err != nil {
		return err
	}
	state.ConfigStale = true
	state.LastError = ""
	if err := a.panelStore.Replace(state); err != nil {
		return err
	}
	_, err := a.generatePanelConfigLocked(nil, false)
	return err
}

func (s *PanelConfig) GenerateConfig() (panelsync.WriteResult, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return panelsync.WriteResult{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	return a.generatePanelConfigLocked(nil, false)
}

// SaveConfigDraft parses a complete editor draft into JSON, then force-generates
// the formal config from that JSON. This is the only supported "save" path for
// text editing, so a manual config edit cannot create a second live model.
func (s *PanelConfig) SaveConfigDraft(draft ConfigDraft) (panelsync.WriteResult, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return panelsync.WriteResult{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	if err := a.backupPanelStateLocked(); err != nil {
		return panelsync.WriteResult{}, err
	}
	imported, err := importDraft(draft, a.panelStore.Snapshot())
	if err != nil {
		return panelsync.WriteResult{}, err
	}
	if imported.NeedsReview {
		return panelsync.WriteResult{}, fmt.Errorf("配置草稿存在冲突，需要先处理: %s", strings.Join(imported.Diff.Conflicts, "; "))
	}
	imported.State.ConfigStale = true
	imported.State.LastError = ""
	if err := a.panelStore.Replace(imported.State); err != nil {
		return panelsync.WriteResult{}, err
	}
	return a.generatePanelConfigLocked(nil, true)
}

// TestHost is the explicit connectivity gate for the JSON editor. It tests
// the JSON fields directly and does not read OpenSSH config.
func (s *PanelConfig) TestHost(host panelstore.PanelHost) (string, error) {
	a := (*App)(s)
	if a == nil {
		return "", fmt.Errorf("应用未初始化")
	}
	return a.testPanelHost(host)
}

func (a *App) comparePanelConfigLocked() (panelsync.ConfigDiff, error) {
	if a.panelStore == nil {
		return panelsync.ConfigDiff{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	path, err := sshConfigPath()
	if err != nil {
		return panelsync.ConfigDiff{}, err
	}
	return panelsync.Compare(context.Background(), path, a.panelStore.Snapshot())
}

func (a *App) ensureTerminalConfigReady() error {
	if a == nil || a.panelStore == nil {
		return nil
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	state := a.panelStore.Snapshot()
	if state.ConfigStale {
		if state.LastError != "" {
			return fmt.Errorf("SSH 配置已过期: %s", state.LastError)
		}
		return fmt.Errorf("SSH 配置已过期，请先生成配置")
	}
	diff, err := a.comparePanelConfigLocked()
	if err != nil {
		return err
	}
	if diff.HasChanges() {
		return fmt.Errorf("SSH 配置存在外部修改，请先导入差异")
	}
	return nil
}

func (a *App) importPanelConfigLocked() (panelsync.ImportResult, error) {
	path, err := sshConfigPath()
	if err != nil {
		return panelsync.ImportResult{}, err
	}
	state := a.panelStore.Snapshot()
	result, err := panelsync.Import(context.Background(), path, state)
	if err != nil || result.NeedsReview || !result.Diff.HasChanges() {
		return result, err
	}
	if err := a.backupPanelStateLocked(); err != nil {
		return panelsync.ImportResult{}, err
	}
	result.State.ConfigStale = false
	result.State.LastError = ""
	if err := a.panelStore.Replace(result.State); err != nil {
		return panelsync.ImportResult{}, err
	}
	if err := a.syncLegacyGroupsFromPanel(result.State); err != nil {
		return panelsync.ImportResult{}, err
	}
	return result, nil
}

func (a *App) backupPanelStateLocked() error {
	if a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	root, err := sshConfigPath()
	if err != nil {
		return err
	}
	files, err := panelsync.ReadTree(root)
	if err != nil {
		return err
	}
	backupRoot := filepath.Join(filepath.Dir(a.panelStore.Path()), "backups")
	if _, err := panelsync.CreateBackup(backupRoot, root, a.panelStore.Snapshot(), files); err != nil {
		return err
	}
	return panelsync.PruneBackups(backupRoot, 50)
}

// mutatePanelStateAndGenerate is the JSON-first mutation seam used by host and
// group services. Drift is checked against the pre-mutation snapshot first;
// the mutation itself may intentionally rename or remove generated config
// files, so generation skips the second drift check after the draft is saved.
// If anything after that point fails, the state remains available and is
// explicitly marked stale.
func (a *App) mutatePanelStateAndGenerate(testAliases []string, mutate func(*panelstore.State) error) error {
	if a == nil || a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	if diff, err := a.comparePanelConfigLocked(); err != nil {
		return err
	} else if diff.HasChanges() {
		err := fmt.Errorf("SSH 配置已被外部修改，请先导入差异后再生成")
		_ = a.markPanelConfigStale(err)
		return err
	}
	if err := a.backupPanelStateLocked(); err != nil {
		return err
	}
	next := a.panelStore.Snapshot()
	if err := mutate(&next); err != nil {
		return err
	}
	next.ConfigStale = true
	next.LastError = ""
	if err := a.panelStore.Replace(next); err != nil {
		return err
	}
	_, err := a.generatePanelConfigLocked(testAliases, true)
	return err
}

func (a *App) updatePanelState(mutate func(*panelstore.State) error) error {
	if a == nil || a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	if err := a.backupPanelStateLocked(); err != nil {
		return err
	}
	return a.panelStore.Update(mutate)
}

// generatePanelConfigLocked is the commit adapter shared by UI edits and
// ordinary host/group mutations. testAliases is intentionally narrow for
// normal host saves; nil means the explicit config editor tests every host.
func (a *App) generatePanelConfigLocked(testAliases []string, force bool) (panelsync.WriteResult, error) {
	if a.panelStore == nil {
		return panelsync.WriteResult{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	fail := func(err error) (panelsync.WriteResult, error) {
		if err != nil {
			_ = a.markPanelConfigStale(err)
		}
		return panelsync.WriteResult{}, err
	}
	state := a.panelStore.Snapshot()
	if !force {
		diff, err := a.comparePanelConfigLocked()
		if err != nil {
			return fail(err)
		}
		if diff.HasChanges() {
			return fail(fmt.Errorf("SSH 配置已被外部修改，请先导入差异后再生成"))
		}
	}
	for _, alias := range testAliases {
		host, ok := a.panelStore.GetHost(alias)
		if !ok {
			return fail(fmt.Errorf("待测试的 Panel 主机不存在: %s", alias))
		}
		if _, err := a.testPanelHost(host); err != nil {
			return fail(err)
		}
	}
	if testAliases == nil {
		for _, host := range state.Hosts {
			if _, err := a.testPanelHost(host); err != nil {
				return fail(err)
			}
		}
	}
	generation, err := panelsync.Generate(state)
	if err != nil {
		return fail(err)
	}
	if err := validateGeneratedConfig(state, generation); err != nil {
		return fail(err)
	}
	root, err := sshConfigPath()
	if err != nil {
		return fail(err)
	}
	backupRoot := filepath.Join(filepath.Dir(a.panelStore.Path()), "backups")
	written, err := panelsync.Write(root, backupRoot, state, generation)
	if err != nil {
		_ = a.markPanelConfigStale(err)
		return panelsync.WriteResult{}, err
	}
	files, err := panelsync.ReadTree(root)
	if err != nil {
		_ = a.markPanelConfigStale(err)
		return written, err
	}
	updated := a.panelStore.Snapshot()
	updated.ConfigStale = false
	updated.LastError = ""
	updated.ConfigLayout.Files = make([]panelstore.ConfigFile, 0, len(files))
	for _, file := range files {
		updated.ConfigLayout.Files = append(updated.ConfigLayout.Files, panelstore.ConfigFile{
			Path: file.Path, Content: file.Content, Mode: file.Mode, SHA256: file.SHA256,
		})
	}
	updated.ConfigLayout.GeneratedFiles = make([]string, 0, len(generation.Files))
	for _, file := range generation.Files {
		updated.ConfigLayout.GeneratedFiles = append(updated.ConfigLayout.GeneratedFiles, file.Path)
	}
	updated.ConfigLayout.ManagedHosts = make([]string, 0, len(updated.Hosts))
	for _, host := range updated.Hosts {
		updated.ConfigLayout.ManagedHosts = append(updated.ConfigLayout.ManagedHosts, host.Alias)
	}
	updated.ConfigLayout.LastGenerated = generation.GeneratedAt
	if err := a.panelStore.Replace(updated); err != nil {
		_ = a.markPanelConfigStale(err)
		return written, err
	}
	return written, nil
}

func (a *App) markPanelConfigStale(cause error) error {
	if a.panelStore == nil {
		return nil
	}
	message := "配置生成失败"
	if cause != nil {
		message = cause.Error()
	}
	return a.panelStore.Update(func(state *panelstore.State) error {
		state.ConfigStale = true
		state.LastError = message
		return nil
	})
}

func (a *App) testPanelHost(host panelstore.PanelHost) (string, error) {
	if strings.TrimSpace(host.Alias) == "" {
		return "", fmt.Errorf("主机别名不能为空")
	}
	identity := ""
	identities := make([]string, 0, len(host.IdentityFiles))
	if len(host.IdentityFiles) > 0 {
		identity = expandTilde(host.IdentityFiles[0])
		for _, file := range host.IdentityFiles {
			identities = append(identities, expandTilde(file))
		}
	}
	opt := sshd.ConnectOption{
		Host: host.Alias, HostName: host.HostName, User: host.User,
		Port: host.Port, IdentityFile: identity, IdentityFiles: identities, Password: host.Password,
		ProxyJump: host.ProxyJump, ProxyCommand: host.ProxyCommand,
		IdentityAgent: expandTilde(host.IdentityAgent), ForwardAgent: host.ForwardAgent,
		HostKeyAlgos: host.HostKeyAlgos,
	}
	if opt.Password == "" && len(opt.IdentityFiles) == 0 &&
		(strings.TrimSpace(host.IdentityAgent) == "" || strings.EqualFold(strings.TrimSpace(host.IdentityAgent), "none")) &&
		os.Getenv("SSH_AUTH_SOCK") == "" {
		return "", fmt.Errorf("主机 %s 没有可用于 Panel 连接测试的密码或密钥", host.Alias)
	}
	defer a.sshMgr.Close(host.Alias)
	if _, err := a.sshMgr.Run(host.Alias, opt, "true", sshd.RunOptions{Timeout: 15 * time.Second}); err != nil {
		return "", fmt.Errorf("主机 %s 连接测试失败: %w", host.Alias, err)
	}
	return fmt.Sprintf("主机 %s 连接测试通过", host.Alias), nil
}

func validateGeneratedConfig(state panelstore.State, generation panelsync.GenerationResult) error {
	tempRoot, err := os.MkdirTemp("", "1pannel-ssh-validate-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempRoot)
	configPath := filepath.Join(tempRoot, "config")
	for _, file := range state.ConfigLayout.Files {
		if err := writeValidationFile(tempRoot, file.Path, file.Content); err != nil {
			return err
		}
	}
	for _, file := range generation.Files {
		content := file.Content
		if file.Path == "config" {
			include := filepath.ToSlash(filepath.Join(tempRoot, "config.d", "*"))
			content = strings.ReplaceAll(content, "Include ~/.ssh/config.d/*", "Include "+include)
		}
		if err := writeValidationFile(tempRoot, file.Path, content); err != nil {
			return err
		}
	}
	for _, relative := range generation.RemovedFiles {
		path := filepath.Join(tempRoot, filepath.FromSlash(relative))
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("清理待删除验证配置失败: %s: %w", relative, err)
		}
	}
	for _, host := range state.Hosts {
		cmd := exec.Command("ssh", "-G", "-F", configPath, host.Alias)
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("ssh -G 校验主机 %s 失败: %w: %s", host.Alias, err, strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func writeValidationFile(root, relative, content string) error {
	path := filepath.Join(root, filepath.FromSlash(relative))
	clean, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	base, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	if clean != base && !strings.HasPrefix(clean, base+string(filepath.Separator)) {
		return fmt.Errorf("验证配置路径越界: %s", relative)
	}
	if err := os.MkdirAll(filepath.Dir(clean), 0700); err != nil {
		return err
	}
	return os.WriteFile(clean, []byte(content), 0600)
}

func importDraft(draft ConfigDraft, previous panelstore.State) (panelsync.ImportResult, error) {
	tempRoot, err := os.MkdirTemp("", "1pannel-config-draft-")
	if err != nil {
		return panelsync.ImportResult{}, err
	}
	defer os.RemoveAll(tempRoot)
	if len(draft.Files) == 0 {
		draft.Files = []panelsync.ConfigFile{{Path: "config", Content: ""}}
	}
	for _, file := range draft.Files {
		content := file.Content
		if file.Path == "config" {
			include := filepath.ToSlash(filepath.Join(tempRoot, "config.d", "*"))
			content = strings.ReplaceAll(content, "Include ~/.ssh/config.d/*", "Include "+include)
		}
		if err := writeValidationFile(tempRoot, file.Path, content); err != nil {
			return panelsync.ImportResult{}, err
		}
	}
	return panelsync.Import(context.Background(), filepath.Join(tempRoot, "config"), previous)
}

func sshConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("无法获取用户主目录: %w", err)
	}
	return filepath.Join(home, ".ssh", "config"), nil
}
