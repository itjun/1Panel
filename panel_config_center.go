package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
	"diteng-pannel/internal/prochide"
)

const (
	panelConfigPreviewTTL = 10 * time.Minute
	panelPasswordMask     = "••••••••"
)

// PanelConfigOverview is the compact state object used by the Config Center
// landing page. The existing PanelConfigStatus remains as a compatibility
// DTO for the settings page and older clients.
type PanelConfigOverview struct {
	PanelPath       string              `json:"panelPath"`
	SSHConfigPath   string              `json:"sshConfigPath"`
	Revision        uint64              `json:"revision"`
	HostCount       int                 `json:"hostCount"`
	GroupCount      int                 `json:"groupCount"`
	ConfigFileCount int                 `json:"configFileCount"`
	IncludeCount    int                 `json:"includeCount"`
	ConfigStale     bool                `json:"configStale"`
	Drift           bool                `json:"drift"`
	NeedsReview     bool                `json:"needsReview"`
	LastGenerated   int64               `json:"lastGenerated"`
	LastBackup      *PanelBackupSummary `json:"lastBackup,omitempty"`
	Diff            PanelConfigDiff     `json:"diff"`
}

// PanelSystemEditor is a safe, user-facing description of an installed
// editor. The frontend sends only ID back to the backend; it never supplies a
// process path or shell command.
type PanelSystemEditor struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Path          string `json:"path"`
	Installed     bool   `json:"installed"`
	SystemDefault bool   `json:"systemDefault"`
}

type systemEditorDefinition struct {
	ID          string
	Name        string
	BundleIDs   []string
	AppNames    []string
	Executables []string
}

var systemEditorDefinitions = []systemEditorDefinition{
	{ID: "vscode", Name: "Visual Studio Code", BundleIDs: []string{"com.microsoft.VSCode"}, AppNames: []string{"Visual Studio Code.app"}, Executables: []string{"code"}},
	{ID: "cursor", Name: "Cursor", BundleIDs: []string{"com.todesktop.230313mzl4w4u92"}, AppNames: []string{"Cursor.app"}, Executables: []string{"cursor"}},
	{ID: "zed", Name: "Zed", BundleIDs: []string{"dev.zed.Zed"}, AppNames: []string{"Zed.app"}, Executables: []string{"zed"}},
	{ID: "textedit", Name: "文本编辑", BundleIDs: []string{"com.apple.TextEdit"}, AppNames: []string{"TextEdit.app"}},
	{ID: "sublime-text", Name: "Sublime Text", BundleIDs: []string{"com.sublimetext.4"}, AppNames: []string{"Sublime Text.app"}, Executables: []string{"subl"}},
	{ID: "coteditor", Name: "CotEditor", BundleIDs: []string{"com.coteditor.CotEditor"}, AppNames: []string{"CotEditor.app"}},
	{ID: "bbedit", Name: "BBEdit", BundleIDs: []string{"com.barebones.bbedit"}, AppNames: []string{"BBEdit.app"}},
	{ID: "nova", Name: "Nova", BundleIDs: []string{"com.panic.Nova"}, AppNames: []string{"Nova.app"}},
	{ID: "textmate", Name: "TextMate", BundleIDs: []string{"com.macromates.TextMate"}, AppNames: []string{"TextMate.app"}},
}

// PanelConfigFile is a safe, UI-oriented file descriptor. Content is
// returned only for files the Config Center can edit; panel.json content is
// always redacted by the backend before it reaches the renderer.
type PanelConfigFile struct {
	Path            string `json:"path"`
	DisplayPath     string `json:"displayPath"`
	AbsolutePath    string `json:"absolutePath"`
	Mode            uint32 `json:"mode"`
	Size            int64  `json:"size"`
	SHA256          string `json:"sha256"`
	UpdatedAt       int64  `json:"updatedAt"`
	Content         string `json:"content"`
	Source          string `json:"source"`
	Generated       bool   `json:"generated"`
	ExternalChanged bool   `json:"externalChanged"`
	PanelJSON       bool   `json:"panelJson"`
}

type PanelConfigFileDiff struct {
	Path             string `json:"path"`
	Kind             string `json:"kind"`
	PanelSHA256      string `json:"panelSha256,omitempty"`
	ExternalSHA256   string `json:"externalSha256,omitempty"`
	GeneratedSHA256  string `json:"generatedSha256,omitempty"`
	PanelContent     string `json:"panelContent,omitempty"`
	ExternalContent  string `json:"externalContent,omitempty"`
	GeneratedContent string `json:"generatedContent,omitempty"`
}

type PanelHostDiff struct {
	Alias     string   `json:"alias"`
	Kind      string   `json:"kind"`
	Fields    []string `json:"fields,omitempty"`
	Panel     string   `json:"panel,omitempty"`
	Candidate string   `json:"candidate,omitempty"`
}

type PanelConfigDiff struct {
	ChangedFiles []PanelConfigFileDiff `json:"changedFiles,omitempty"`
	AddedHosts   []string              `json:"addedHosts,omitempty"`
	RemovedHosts []string              `json:"removedHosts,omitempty"`
	ChangedHosts []string              `json:"changedHosts,omitempty"`
	HostDiff     []PanelHostDiff       `json:"hostDiff,omitempty"`
	Conflicts    []PanelConfigConflict `json:"conflicts,omitempty"`
	HasChanges   bool                  `json:"hasChanges"`
}

// PanelHostDraft intentionally does not expose the system-owned fields in
// panelstore.PanelHost. A masked password is merged with the current secret
// server-side; the mask is never written to panel.json.
type PanelHostDraft struct {
	Alias         string                   `json:"alias"`
	HostName      string                   `json:"hostName"`
	User          string                   `json:"user"`
	Port          string                   `json:"port,omitempty"`
	Password      string                   `json:"password,omitempty"`
	IdentityFiles []string                 `json:"identityFiles,omitempty"`
	ProxyJump     string                   `json:"proxyJump,omitempty"`
	ProxyCommand  string                   `json:"proxyCommand,omitempty"`
	IdentityAgent string                   `json:"identityAgent,omitempty"`
	ForwardAgent  bool                     `json:"forwardAgent,omitempty"`
	HostKeyAlgos  string                   `json:"hostKeyAlgos,omitempty"`
	PortForwards  []panelstore.PortForward `json:"portForwards,omitempty"`
	Note          string                   `json:"note,omitempty"`
	GroupID       string                   `json:"groupId,omitempty"`
	Order         int                      `json:"order,omitempty"`
	ExtraOptions  []panelstore.SSHOption   `json:"extraOptions,omitempty"`
}

type PanelStateDraft struct {
	Hosts        []PanelHostDraft        `json:"hosts"`
	Groups       []panelstore.PanelGroup `json:"groups"`
	ExtraOptions []panelstore.SSHOption  `json:"extraOptions,omitempty"`
}

type ConnectionTestResult struct {
	Alias      string `json:"alias"`
	Success    bool   `json:"success"`
	Tested     bool   `json:"tested"`
	Message    string `json:"message,omitempty"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"durationMs"`
}

type PanelConfigConflict struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	File     string `json:"file,omitempty"`
	Alias    string `json:"alias,omitempty"`
	Summary  string `json:"summary"`
	Panel    string `json:"panel,omitempty"`
	External string `json:"external,omitempty"`
	Resolved bool   `json:"resolved"`
}

type PanelConfigResolution struct {
	ID     string `json:"id"`
	Choice string `json:"choice"` // panel, external, manual
	Manual string `json:"manual,omitempty"`
}

type PanelConfigPreview struct {
	PreviewID       string                 `json:"previewId"`
	BaseRevision    uint64                 `json:"baseRevision"`
	BaseConfigHash  string                 `json:"baseConfigHash"`
	AffectedHosts   []string               `json:"affectedHosts,omitempty"`
	ConnectionTests []ConnectionTestResult `json:"connectionTests,omitempty"`
	FileDiff        []PanelConfigFileDiff  `json:"fileDiff,omitempty"`
	HostDiff        []PanelHostDiff        `json:"hostDiff,omitempty"`
	Conflicts       []PanelConfigConflict  `json:"conflicts,omitempty"`
	Valid           bool                   `json:"valid"`
	Source          string                 `json:"source"`
	Error           string                 `json:"error,omitempty"`
	ExpiresAt       int64                  `json:"expiresAt"`
}

type PanelBackupSummary struct {
	ID         string `json:"id"`
	Path       string `json:"path"`
	CreatedAt  int64  `json:"createdAt"`
	Revision   uint64 `json:"revision"`
	HostCount  int    `json:"hostCount"`
	GroupCount int    `json:"groupCount"`
	FileCount  int    `json:"fileCount"`
	Size       int64  `json:"size"`
	Operation  string `json:"operation"`
}

type PanelBackup struct {
	Summary PanelBackupSummary `json:"summary"`
	State   PanelStateDraft    `json:"state"`
	Files   []PanelConfigFile  `json:"files"`
}

type panelConfigPreviewRecord struct {
	Preview       PanelConfigPreview
	candidate     panelstore.State
	externalState panelstore.State
	baseState     panelstore.State
	configFiles   []panelsync.ConfigFile
	force         bool
}

func (s *PanelConfig) GetOverview() (PanelConfigOverview, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return PanelConfigOverview{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	return a.getPanelConfigOverviewLocked()
}

func (a *App) getPanelConfigOverviewLocked() (PanelConfigOverview, error) {
	root, err := sshConfigPath()
	if err != nil {
		return PanelConfigOverview{}, err
	}
	state := a.panelStore.Snapshot()
	files, err := panelsync.ReadTree(root)
	if err != nil {
		return PanelConfigOverview{}, err
	}
	diff, err := panelsync.Compare(context.Background(), root, state)
	if err != nil {
		return PanelConfigOverview{}, err
	}
	structured := a.makePanelConfigDiff(state, files, diff, nil)
	overview := PanelConfigOverview{
		PanelPath:       a.panelStore.Path(),
		SSHConfigPath:   root,
		Revision:        state.Revision,
		HostCount:       len(state.Hosts),
		GroupCount:      len(state.Groups),
		ConfigFileCount: len(files),
		IncludeCount:    countIncludeFiles(files),
		ConfigStale:     state.ConfigStale,
		Drift:           diff.HasChanges(),
		NeedsReview:     len(diff.Conflicts) > 0,
		LastGenerated:   state.ConfigLayout.LastGenerated,
		Diff:            structured,
	}
	if backups, backupErr := a.listPanelBackupsLocked(); backupErr == nil && len(backups) > 0 {
		overview.LastBackup = &backups[0]
	}
	return overview, nil
}

func (s *PanelConfig) GetConfigTree() ([]PanelConfigFile, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return nil, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	return a.getPanelConfigTreeLocked()
}

func (a *App) getPanelConfigTreeLocked() ([]PanelConfigFile, error) {
	root, err := sshConfigPath()
	if err != nil {
		return nil, err
	}
	state := a.panelStore.Snapshot()
	files, err := panelsync.ReadTree(root)
	if err != nil {
		return nil, err
	}
	snapshot := make(map[string]panelstore.ConfigFile, len(state.ConfigLayout.Files))
	for _, file := range state.ConfigLayout.Files {
		snapshot[file.Path] = file
	}
	generated := make(map[string]bool, len(state.ConfigLayout.GeneratedFiles))
	for _, path := range state.ConfigLayout.GeneratedFiles {
		generated[path] = true
	}
	out := make([]PanelConfigFile, 0, len(files)+1)
	panelPath := a.panelStore.Path()
	panelInfo, panelErr := os.Stat(panelPath)
	panelContent, err := json.MarshalIndent(a.editablePanelState(state), "", "  ")
	if err != nil {
		return nil, err
	}
	panelFile := PanelConfigFile{
		Path:         "panel.json",
		DisplayPath:  panelPath,
		AbsolutePath: panelPath,
		Content:      string(panelContent),
		Source:       "Panel JSON",
		PanelJSON:    true,
		Generated:    false,
	}
	if panelErr == nil {
		panelFile.Mode = uint32(panelInfo.Mode().Perm())
		panelFile.Size = panelInfo.Size()
		panelFile.UpdatedAt = panelInfo.ModTime().Unix()
		if raw, readErr := os.ReadFile(panelPath); readErr == nil {
			panelFile.SHA256 = panelstore.SHA256(raw)
			fullState, marshalErr := json.MarshalIndent(state, "", "  ")
			panelFile.ExternalChanged = marshalErr == nil && !bytes.Equal(raw, fullState)
		}
	}
	if panelFile.SHA256 == "" {
		panelFile.SHA256 = panelstore.SHA256(panelContent)
	}
	out = append(out, panelFile)
	for _, file := range files {
		absolute := filepath.Join(filepath.Dir(root), filepath.FromSlash(file.Path))
		info, statErr := os.Stat(absolute)
		old, hadSnapshot := snapshot[file.Path]
		out = append(out, PanelConfigFile{
			Path:            file.Path,
			DisplayPath:     absolute,
			AbsolutePath:    absolute,
			Mode:            file.Mode,
			Size:            int64(len(file.Content)),
			SHA256:          file.SHA256,
			UpdatedAt:       fileUpdatedAt(info, statErr),
			Content:         file.Content,
			Source:          "OpenSSH config",
			Generated:       generated[file.Path],
			ExternalChanged: !hadSnapshot || old.SHA256 != file.SHA256,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].PanelJSON != out[j].PanelJSON {
			return out[i].PanelJSON
		}
		return out[i].Path < out[j].Path
	})
	return out, nil
}

func (s *PanelConfig) GetEditablePanelState() (PanelStateDraft, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return PanelStateDraft{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	return a.editablePanelState(a.panelStore.Snapshot()), nil
}

// GetEditablePanelStateSensitive is intentionally separate from the normal
// editor endpoint. The UI calls it only for an explicit, temporary reveal and
// immediately discards the returned plaintext when the view is left.
func (s *PanelConfig) GetEditablePanelStateSensitive() (PanelStateDraft, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return PanelStateDraft{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	state := a.panelStore.Snapshot()
	draft := a.editablePanelState(state)
	for i := range draft.Hosts {
		if host, ok := hostByAlias(state.Hosts, draft.Hosts[i].Alias); ok {
			draft.Hosts[i].Password = host.Password
		}
	}
	return draft, nil
}

func (a *App) editablePanelState(state panelstore.State) PanelStateDraft {
	draft := PanelStateDraft{
		Hosts:        make([]PanelHostDraft, 0, len(state.Hosts)),
		Groups:       append([]panelstore.PanelGroup(nil), state.Groups...),
		ExtraOptions: append([]panelstore.SSHOption(nil), state.ExtraOptions...),
	}
	for _, host := range state.Hosts {
		draft.Hosts = append(draft.Hosts, PanelHostDraft{
			Alias: host.Alias, HostName: host.HostName, User: host.User, Port: host.Port,
			Password: maskedPassword(host.Password), IdentityFiles: append([]string(nil), host.IdentityFiles...),
			ProxyJump: host.ProxyJump, ProxyCommand: host.ProxyCommand, IdentityAgent: host.IdentityAgent,
			ForwardAgent: host.ForwardAgent, HostKeyAlgos: host.HostKeyAlgos,
			PortForwards: append([]panelstore.PortForward(nil), host.PortForwards...), Note: host.Note,
			GroupID: host.GroupID, Order: host.Order, ExtraOptions: append([]panelstore.SSHOption(nil), host.ExtraOptions...),
		})
	}
	return draft
}

func maskedPassword(password string) string {
	if strings.TrimSpace(password) == "" {
		return ""
	}
	return panelPasswordMask
}

func (s *PanelConfig) PreviewPanelState(draft PanelStateDraft) (PanelConfigPreview, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return PanelConfigPreview{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	base := a.panelStore.Snapshot()
	root, err := sshConfigPath()
	if err != nil {
		return PanelConfigPreview{}, err
	}
	currentFiles, err := panelsync.ReadTree(root)
	if err != nil {
		return PanelConfigPreview{}, err
	}
	existingDiff, err := panelsync.Compare(context.Background(), root, base)
	if err != nil {
		return PanelConfigPreview{}, err
	}
	candidate, err := stateFromPanelDraft(base, draft)
	if err != nil {
		return PanelConfigPreview{}, err
	}
	var conflicts []PanelConfigConflict
	if existingDiff.HasChanges() {
		conflicts = append(conflicts, a.driftConflicts(base, currentFiles, existingDiff)...)
	}
	return a.createPanelPreviewLocked(base, candidate, currentFiles, "panel", false, conflicts)
}

func (s *PanelConfig) PreviewConfigDraft(draft ConfigDraft) (PanelConfigPreview, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return PanelConfigPreview{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	base := a.panelStore.Snapshot()
	root, err := sshConfigPath()
	if err != nil {
		return PanelConfigPreview{}, err
	}
	currentFiles, err := panelsync.ReadTree(root)
	if err != nil {
		return PanelConfigPreview{}, err
	}
	if len(draft.Files) == 0 {
		draft.Files = []panelsync.ConfigFile{{Path: "config", Content: "", Mode: 0600}}
	}
	imported, err := importDraft(draft, base)
	if err != nil {
		return PanelConfigPreview{}, err
	}
	candidate := base
	if imported.Diff.Imported != nil {
		candidate = *imported.Diff.Imported
	}
	conflicts := a.publicConfigConflicts(imported.Diff.Conflicts, base, candidate, draft.Files)
	return a.createPanelPreviewLocked(base, candidate, currentFiles, "config", true, conflicts)
}

func (a *App) createPanelPreviewLocked(base, candidate panelstore.State, currentFiles []panelsync.ConfigFile, source string, force bool, conflicts []PanelConfigConflict) (PanelConfigPreview, error) {
	if a.panelPreviews == nil {
		a.panelPreviews = make(map[string]panelConfigPreviewRecord)
	}
	gen, err := panelsync.Generate(candidate)
	if err != nil {
		return PanelConfigPreview{}, err
	}
	if err := validateGeneratedConfig(candidate, gen); err != nil {
		return PanelConfigPreview{}, err
	}
	aliases := changedConnectionAliases(base.Hosts, candidate.Hosts)
	tests := make([]ConnectionTestResult, 0, len(aliases))
	validTests := true
	for _, alias := range aliases {
		host, ok := hostByAlias(candidate.Hosts, alias)
		if !ok {
			continue
		}
		started := time.Now()
		message, testErr := a.testPanelHost(host)
		result := ConnectionTestResult{Alias: alias, Tested: true, Success: testErr == nil, DurationMs: time.Since(started).Milliseconds()}
		if testErr != nil {
			result.Error = testErr.Error()
			validTests = false
		} else {
			result.Message = message
		}
		tests = append(tests, result)
	}
	if len(conflicts) > 0 {
		validTests = false
	}
	preview := PanelConfigPreview{
		PreviewID:       uuid.NewString(),
		BaseRevision:    base.Revision,
		BaseConfigHash:  configFilesHash(currentFiles),
		AffectedHosts:   append([]string(nil), aliases...),
		ConnectionTests: tests,
		FileDiff:        a.makeFileDiff(base, currentFiles, gen),
		HostDiff:        makeHostDiff(base.Hosts, candidate.Hosts),
		Conflicts:       conflicts,
		Valid:           validTests,
		Source:          source,
		ExpiresAt:       time.Now().Add(panelConfigPreviewTTL).Unix(),
	}
	for _, test := range tests {
		if !test.Success {
			preview.Error = "至少一台受影响主机连接测试失败，整批提交已阻止"
			break
		}
	}
	if len(conflicts) > 0 && preview.Error == "" {
		preview.Error = "存在未解决的配置冲突"
	}
	a.panelPreviews[preview.PreviewID] = panelConfigPreviewRecord{
		Preview: preview, candidate: candidate, externalState: candidate, baseState: base,
		configFiles: append([]panelsync.ConfigFile(nil), currentFiles...), force: force,
	}
	return preview, nil
}

func (s *PanelConfig) CommitPanelPreview(previewID string) (panelsync.WriteResult, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return panelsync.WriteResult{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	record, ok := a.panelPreviews[previewID]
	if !ok || time.Now().Unix() > record.Preview.ExpiresAt {
		delete(a.panelPreviews, previewID)
		return panelsync.WriteResult{}, fmt.Errorf("配置预览已过期，请重新预览")
	}
	if !record.Preview.Valid || len(record.Preview.Conflicts) > 0 {
		return panelsync.WriteResult{}, fmt.Errorf("配置预览未通过校验，不能提交: %s", record.Preview.Error)
	}
	current := a.panelStore.Snapshot()
	if current.Revision != record.Preview.BaseRevision {
		return panelsync.WriteResult{}, fmt.Errorf("Panel JSON 已被其他操作修改，请刷新后重新预览")
	}
	root, err := sshConfigPath()
	if err != nil {
		return panelsync.WriteResult{}, err
	}
	currentFiles, err := panelsync.ReadTree(root)
	if err != nil {
		return panelsync.WriteResult{}, err
	}
	if configFilesHash(currentFiles) != record.Preview.BaseConfigHash {
		return panelsync.WriteResult{}, fmt.Errorf("SSH 配置在预览后发生外部修改，请重新导入或预览")
	}
	if err := a.backupPanelStateLocked(); err != nil {
		return panelsync.WriteResult{}, err
	}
	next := record.candidate
	next.ConfigStale = true
	next.LastError = ""
	if err := a.panelStore.Replace(next); err != nil {
		return panelsync.WriteResult{}, err
	}
	if err := a.syncLegacyGroupsFromPanel(a.panelStore.Snapshot()); err != nil {
		return panelsync.WriteResult{}, err
	}
	result, err := a.generatePanelConfigLocked(record.Preview.AffectedHosts, record.force)
	delete(a.panelPreviews, previewID)
	if err != nil {
		return result, err
	}
	return result, nil
}

func (s *PanelConfig) ResolveConfigConflicts(previewID string, resolutions []PanelConfigResolution) (PanelConfigPreview, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return PanelConfigPreview{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	record, ok := a.panelPreviews[previewID]
	if !ok || time.Now().Unix() > record.Preview.ExpiresAt {
		return PanelConfigPreview{}, fmt.Errorf("配置预览已过期，请重新预览")
	}
	byID := make(map[string]PanelConfigResolution, len(resolutions))
	for _, resolution := range resolutions {
		byID[resolution.ID] = resolution
	}
	for _, conflict := range record.Preview.Conflicts {
		if _, ok := byID[conflict.ID]; !ok {
			return PanelConfigPreview{}, fmt.Errorf("冲突 %s 尚未选择处理方式", conflict.ID)
		}
	}
	next := record.candidate
	files := make([]panelsync.ConfigFile, 0, len(record.candidate.ConfigLayout.Files))
	for _, file := range record.candidate.ConfigLayout.Files {
		files = append(files, panelsync.ConfigFile{Path: file.Path, Content: file.Content, Mode: file.Mode, SHA256: file.SHA256})
	}
	for _, conflict := range record.Preview.Conflicts {
		resolution, ok := byID[conflict.ID]
		if !ok {
			continue
		}
		choice := strings.ToLower(strings.TrimSpace(resolution.Choice))
		switch choice {
		case "panel":
			if conflict.Alias != "" {
				if host, found := hostByAlias(record.baseState.Hosts, conflict.Alias); found {
					next.Hosts = replacePanelHost(next.Hosts, host)
				}
			} else if conflict.File != "" {
				if file, found := panelFile(record.baseState.ConfigLayout.Files, conflict.File); found {
					files = replaceConfigFile(files, panelsync.ConfigFile{Path: file.Path, Content: file.Content, Mode: file.Mode, SHA256: panelstore.SHA256([]byte(file.Content))})
				}
			}
		case "external":
			// The candidate already represents the external side.
		case "manual":
			if conflict.File == "" || strings.TrimSpace(resolution.Manual) == "" {
				return PanelConfigPreview{}, fmt.Errorf("冲突 %s 的手工内容不能为空", conflict.ID)
			}
			files = replaceConfigFile(files, panelsync.ConfigFile{Path: conflict.File, Content: resolution.Manual, Mode: 0600, SHA256: panelstore.SHA256([]byte(resolution.Manual))})
		default:
			return PanelConfigPreview{}, fmt.Errorf("冲突 %s 的处理方式无效: %s", conflict.ID, resolution.Choice)
		}
	}
	// A resolved file choice must be reflected in the candidate's raw layout;
	// otherwise the generator would immediately restore the old layout.
	next.ConfigLayout.Files = make([]panelstore.ConfigFile, 0, len(files))
	for _, file := range files {
		next.ConfigLayout.Files = append(next.ConfigLayout.Files, panelstore.ConfigFile{Path: file.Path, Content: file.Content, Mode: file.Mode, SHA256: file.SHA256})
	}
	next.ConfigStale = true
	next.LastError = ""
	delete(a.panelPreviews, previewID)
	return a.createPanelPreviewLocked(record.baseState, next, record.configFiles, "resolved", true, nil)
}

func (s *PanelConfig) ListPanelBackups() ([]PanelBackupSummary, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return nil, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	return a.listPanelBackupsLocked()
}

func (a *App) listPanelBackupsLocked() ([]PanelBackupSummary, error) {
	root := filepath.Join(filepath.Dir(a.panelStore.Path()), "backups")
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return []PanelBackupSummary{}, nil
	}
	if err != nil {
		return nil, err
	}
	result := make([]PanelBackupSummary, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !safeBackupID(entry.Name()) {
			continue
		}
		path := filepath.Join(root, entry.Name())
		state, stateErr := panelstore.LoadStateFile(filepath.Join(path, "panel.json"))
		if stateErr != nil {
			continue
		}
		manifest, files, manifestErr := readBackupManifest(path)
		if manifestErr != nil {
			continue
		}
		created := manifest.CreatedAt
		if created == 0 {
			if info, statErr := entry.Info(); statErr == nil {
				created = info.ModTime().Unix()
			}
		}
		result = append(result, PanelBackupSummary{
			ID: entry.Name(), Path: path, CreatedAt: created, Revision: state.Revision,
			HostCount: len(state.Hosts), GroupCount: len(state.Groups), FileCount: len(files),
			Size: directorySize(path), Operation: "automatic",
		})
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].CreatedAt > result[j].CreatedAt })
	return result, nil
}

func (s *PanelConfig) GetPanelBackup(id string) (PanelBackup, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return PanelBackup{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	path, err := a.panelBackupPath(id)
	if err != nil {
		return PanelBackup{}, err
	}
	state, err := panelstore.LoadStateFile(filepath.Join(path, "panel.json"))
	if err != nil {
		return PanelBackup{}, fmt.Errorf("读取备份 JSON 失败: %w", err)
	}
	manifest, files, err := readBackupManifest(path)
	if err != nil {
		return PanelBackup{}, err
	}
	return PanelBackup{
		Summary: PanelBackupSummary{ID: filepath.Base(path), Path: path, CreatedAt: manifest.CreatedAt, Revision: state.Revision, HostCount: len(state.Hosts), GroupCount: len(state.Groups), FileCount: len(files), Size: directorySize(path), Operation: "automatic"},
		State:   a.editablePanelState(state), Files: a.panelBackupFiles(path, files),
	}, nil
}

func (s *PanelConfig) RestorePanelBackup(id string) (panelsync.WriteResult, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return panelsync.WriteResult{}, fmt.Errorf("Panel 主机存储未初始化")
	}
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	path, err := a.panelBackupPath(id)
	if err != nil {
		return panelsync.WriteResult{}, err
	}
	backupState, files, err := loadBackupStateAndFiles(path)
	if err != nil {
		return panelsync.WriteResult{}, err
	}
	root, err := sshConfigPath()
	if err != nil {
		return panelsync.WriteResult{}, err
	}
	currentFiles, err := panelsync.ReadTree(root)
	if err != nil {
		return panelsync.WriteResult{}, err
	}
	generation := panelsync.GenerationResult{Files: files, GeneratedAt: time.Now().Unix()}
	backupPaths := make(map[string]bool, len(files))
	for _, file := range files {
		backupPaths[file.Path] = true
	}
	for _, file := range currentFiles {
		if !backupPaths[file.Path] {
			generation.RemovedFiles = append(generation.RemovedFiles, file.Path)
		}
	}
	if err := validateGeneratedConfig(backupState, generation); err != nil {
		return panelsync.WriteResult{}, fmt.Errorf("备份 SSH 配置校验失败: %w", err)
	}
	backupRoot := filepath.Join(filepath.Dir(a.panelStore.Path()), "backups")
	result, err := panelsync.Write(root, backupRoot, a.panelStore.Snapshot(), generation)
	if err != nil {
		return panelsync.WriteResult{}, err
	}
	backupState.ConfigStale = false
	backupState.LastError = ""
	if err := a.panelStore.Replace(backupState); err != nil {
		_ = a.markPanelConfigStale(err)
		return result, fmt.Errorf("恢复 Panel JSON 失败，SSH 配置已写入并标记为过期: %w", err)
	}
	if err := a.syncLegacyGroupsFromPanel(a.panelStore.Snapshot()); err != nil {
		return result, err
	}
	_ = panelsync.PruneBackups(backupRoot, 50)
	return result, nil
}

func (s *PanelConfig) OpenPanelPath(path string) error {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	allowed, err := a.controlledPanelPath(path)
	if err != nil {
		return err
	}
	return openPanelPath(allowed, false)
}

// ListSystemEditors returns the installed applications that Panel can safely
// launch for a controlled config path. Discovery is performed on every call
// so an editor installed or removed while Panel is running is reflected in
// the picker immediately.
func (s *PanelConfig) ListSystemEditors() ([]PanelSystemEditor, error) {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return nil, fmt.Errorf("Panel 主机存储未初始化")
	}
	return discoverSystemEditors(), nil
}

// OpenPanelPathWithEditor opens a controlled Panel file in an editor selected
// from ListSystemEditors. The editor ID is resolved again on the backend so a
// caller cannot turn this into an arbitrary command or path launcher.
func (s *PanelConfig) OpenPanelPathWithEditor(path, editorID string) error {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	allowed, err := a.controlledPanelPath(path)
	if err != nil {
		return err
	}
	if editorID == "" || editorID == "system-default" {
		return openPanelPath(allowed, false)
	}
	editor, ok := findSystemEditor(editorID)
	if !ok {
		return fmt.Errorf("系统编辑器不可用或已被卸载: %s", editorID)
	}
	return openPanelPathWithEditor(allowed, editor)
}

func (s *PanelConfig) RevealPanelPath(path string) error {
	a := (*App)(s)
	if a == nil || a.panelStore == nil {
		return fmt.Errorf("Panel 主机存储未初始化")
	}
	allowed, err := a.controlledPanelPath(path)
	if err != nil {
		return err
	}
	return openPanelPath(allowed, true)
}

func (a *App) panelBackupPath(id string) (string, error) {
	if !safeBackupID(id) {
		return "", fmt.Errorf("备份 ID 无效")
	}
	root := filepath.Join(filepath.Dir(a.panelStore.Path()), "backups")
	path := filepath.Join(root, id)
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	base, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(resolved, base+string(filepath.Separator)) {
		return "", fmt.Errorf("备份路径越界")
	}
	if linkInfo, err := os.Lstat(resolved); err != nil || linkInfo.Mode()&os.ModeSymlink != 0 || !linkInfo.IsDir() {
		return "", fmt.Errorf("备份不存在: %s", id)
	}
	return resolved, nil
}

func safeBackupID(id string) bool {
	return id != "" && id != "." && id != ".." && filepath.Base(id) == id && !strings.ContainsAny(id, `/\\`) && !strings.ContainsAny(id, "\r\n")
}

func loadBackupStateAndFiles(path string) (panelstore.State, []panelsync.ConfigFile, error) {
	state, err := panelstore.LoadStateFile(filepath.Join(path, "panel.json"))
	if err != nil {
		return panelstore.State{}, nil, fmt.Errorf("读取备份 JSON 失败: %w", err)
	}
	_, files, err := readBackupManifest(path)
	if err != nil {
		return panelstore.State{}, nil, err
	}
	for i := range files {
		if !safeConfigRelative(files[i].Path) {
			return panelstore.State{}, nil, fmt.Errorf("备份配置路径越界: %s", files[i].Path)
		}
		content, err := os.ReadFile(filepath.Join(path, "config", filepath.FromSlash(files[i].Path)))
		if err != nil {
			return panelstore.State{}, nil, fmt.Errorf("读取备份配置失败: %s: %w", files[i].Path, err)
		}
		files[i].Content = string(content)
		files[i].SHA256 = panelstore.SHA256(content)
	}
	return state, files, nil
}

func readBackupManifest(path string) (struct {
	Version   int                    `json:"version"`
	CreatedAt int64                  `json:"createdAt"`
	Files     []panelsync.ConfigFile `json:"files"`
}, []panelsync.ConfigFile, error) {
	var manifest struct {
		Version   int                    `json:"version"`
		CreatedAt int64                  `json:"createdAt"`
		Files     []panelsync.ConfigFile `json:"files"`
	}
	b, err := os.ReadFile(filepath.Join(path, "manifest.json"))
	if err != nil {
		return manifest, nil, fmt.Errorf("读取备份清单失败: %w", err)
	}
	if err := json.Unmarshal(b, &manifest); err != nil {
		return manifest, nil, fmt.Errorf("解析备份清单失败: %w", err)
	}
	return manifest, manifest.Files, nil
}

func (a *App) panelBackupFiles(path string, files []panelsync.ConfigFile) []PanelConfigFile {
	out := make([]PanelConfigFile, 0, len(files))
	for _, file := range files {
		content, err := os.ReadFile(filepath.Join(path, "config", filepath.FromSlash(file.Path)))
		if err != nil {
			continue
		}
		out = append(out, PanelConfigFile{Path: file.Path, DisplayPath: file.Path, AbsolutePath: filepath.Join(path, "config", filepath.FromSlash(file.Path)), Mode: file.Mode, Size: int64(len(content)), SHA256: panelstore.SHA256(content), Content: string(content), Source: "备份", Generated: true})
	}
	return out
}

func (a *App) controlledPanelPath(input string) (string, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return "", fmt.Errorf("路径不能为空")
	}
	sshConfig, err := sshConfigPath()
	if err != nil {
		return "", err
	}
	sshDir := filepath.Dir(sshConfig)
	backupRoot := filepath.Join(filepath.Dir(a.panelStore.Path()), "backups")
	if !filepath.IsAbs(input) {
		switch filepath.ToSlash(input) {
		case "panel.json":
			input = a.panelStore.Path()
		case "config", "~/.ssh/config":
			input = sshConfig
		case "config.d", "~/.ssh/config.d":
			input = filepath.Join(sshDir, "config.d")
		case "backups":
			input = backupRoot
		default:
			input = filepath.Join(sshDir, filepath.FromSlash(input))
		}
	}
	clean, err := filepath.Abs(filepath.Clean(input))
	if err != nil {
		return "", err
	}
	allowedFiles := []string{filepath.Clean(a.panelStore.Path()), filepath.Clean(sshConfig)}
	allowedDirs := []string{filepath.Clean(filepath.Join(sshDir, "config.d")), filepath.Clean(backupRoot)}
	ok := false
	for _, file := range allowedFiles {
		if clean == file {
			ok = true
			break
		}
	}
	if !ok {
		for _, dir := range allowedDirs {
			if clean == dir || strings.HasPrefix(clean, dir+string(filepath.Separator)) {
				ok = true
				break
			}
		}
	}
	if !ok {
		return "", fmt.Errorf("路径不在 Panel 配置白名单内: %s", input)
	}
	if info, err := os.Lstat(clean); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("拒绝打开符号链接路径: %s", clean)
	}
	return clean, nil
}

func discoverSystemEditors() []PanelSystemEditor {
	editors := []PanelSystemEditor{{
		ID:            "system-default",
		Name:          "系统默认编辑器",
		Path:          "由系统默认应用打开",
		Installed:     true,
		SystemDefault: true,
	}}
	for _, definition := range systemEditorDefinitions {
		path := resolveSystemEditorPath(definition)
		if path == "" {
			continue
		}
		editors = append(editors, PanelSystemEditor{ID: definition.ID, Name: definition.Name, Path: path, Installed: true})
	}
	return editors
}

func findSystemEditor(id string) (PanelSystemEditor, bool) {
	for _, editor := range discoverSystemEditors() {
		if editor.ID == id && !editor.SystemDefault {
			return editor, true
		}
	}
	return PanelSystemEditor{}, false
}

func resolveSystemEditorPath(definition systemEditorDefinition) string {
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		roots := []string{"/Applications", filepath.Join(home, "Applications"), "/System/Applications"}
		for _, root := range roots {
			for _, appName := range definition.AppNames {
				candidate := filepath.Join(root, appName)
				if info, err := os.Stat(candidate); err == nil && info.IsDir() {
					return candidate
				}
			}
		}
		if _, err := exec.LookPath("mdfind"); err == nil {
			for _, bundleID := range definition.BundleIDs {
				query := fmt.Sprintf("kMDItemCFBundleIdentifier == '%s'", bundleID)
				output, err := exec.Command("mdfind", query).Output()
				if err != nil {
					continue
				}
				for _, candidate := range strings.Split(string(output), "\n") {
					candidate = strings.TrimSpace(candidate)
					if strings.HasSuffix(candidate, ".app") {
						if info, err := os.Stat(candidate); err == nil && info.IsDir() {
							return candidate
						}
					}
				}
			}
		}
	case "windows", "linux":
		for _, executable := range definition.Executables {
			if path, err := exec.LookPath(executable); err == nil {
				return path
			}
		}
	}
	return ""
}

func openPanelPath(path string, reveal bool) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		if reveal {
			cmd = exec.Command("open", "-R", path)
		} else {
			cmd = exec.Command("open", path)
		}
	case "windows":
		if reveal {
			cmd = exec.Command("explorer", "/select,"+path)
		} else {
			cmd = exec.Command("cmd", "/c", "start", "", path)
		}
	default:
		if reveal {
			path = filepath.Dir(path)
		}
		cmd = exec.Command("xdg-open", path)
	}
	prochide.Hide(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("打开配置路径失败: %w", err)
	}
	return nil
}

func openPanelPathWithEditor(path string, editor PanelSystemEditor) error {
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		cmd = exec.Command("open", "-a", editor.Path, path)
	} else {
		cmd = exec.Command(editor.Path, path)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("使用 %s 打开配置失败: %w", editor.Name, err)
	}
	return nil
}

func stateFromPanelDraft(base panelstore.State, draft PanelStateDraft) (panelstore.State, error) {
	next := base
	next.Hosts = make([]panelstore.PanelHost, 0, len(draft.Hosts))
	old := make(map[string]panelstore.PanelHost, len(base.Hosts))
	for _, host := range base.Hosts {
		old[host.Alias] = host
	}
	for _, draftHost := range draft.Hosts {
		host := panelstore.PanelHost{
			Alias: strings.TrimSpace(draftHost.Alias), HostName: strings.TrimSpace(draftHost.HostName), User: strings.TrimSpace(draftHost.User), Port: strings.TrimSpace(draftHost.Port), Password: draftHost.Password,
			IdentityFiles: append([]string(nil), draftHost.IdentityFiles...), ProxyJump: draftHost.ProxyJump, ProxyCommand: draftHost.ProxyCommand, IdentityAgent: draftHost.IdentityAgent,
			ForwardAgent: draftHost.ForwardAgent, HostKeyAlgos: draftHost.HostKeyAlgos, PortForwards: append([]panelstore.PortForward(nil), draftHost.PortForwards...), Note: draftHost.Note,
			GroupID: draftHost.GroupID, Order: draftHost.Order, ExtraOptions: append([]panelstore.SSHOption(nil), draftHost.ExtraOptions...),
		}
		if host.Password == panelPasswordMask {
			if previous, ok := old[host.Alias]; ok {
				host.Password = previous.Password
			}
		}
		next.Hosts = append(next.Hosts, host)
	}
	next.Groups = append([]panelstore.PanelGroup(nil), draft.Groups...)
	next.ExtraOptions = append([]panelstore.SSHOption(nil), draft.ExtraOptions...)
	next.ConfigStale = true
	next.LastError = ""
	return next, nil
}

func changedConnectionAliases(before, after []panelstore.PanelHost) []string {
	left := make(map[string]panelstore.PanelHost, len(before))
	right := make(map[string]panelstore.PanelHost, len(after))
	for _, host := range before {
		left[host.Alias] = host
	}
	for _, host := range after {
		right[host.Alias] = host
	}
	changed := make([]string, 0)
	for alias, host := range right {
		previous, ok := left[alias]
		if !ok || !reflect.DeepEqual(connectionShapeOf(previous), connectionShapeOf(host)) {
			changed = append(changed, alias)
		}
	}
	sort.Strings(changed)
	return changed
}

type panelConnectionShape struct {
	HostName      string
	User          string
	Port          string
	Password      string
	IdentityFiles []string
	ProxyJump     string
	ProxyCommand  string
	IdentityAgent string
	ForwardAgent  bool
	HostKeyAlgos  string
	PortForwards  []panelstore.PortForward
	ExtraOptions  []panelstore.SSHOption
}

func connectionShapeOf(host panelstore.PanelHost) panelConnectionShape {
	port := host.Port
	if port == "" {
		port = "22"
	}
	return panelConnectionShape{HostName: host.HostName, User: host.User, Port: port, Password: host.Password, IdentityFiles: append([]string(nil), host.IdentityFiles...), ProxyJump: host.ProxyJump, ProxyCommand: host.ProxyCommand, IdentityAgent: host.IdentityAgent, ForwardAgent: host.ForwardAgent, HostKeyAlgos: host.HostKeyAlgos, PortForwards: append([]panelstore.PortForward(nil), host.PortForwards...), ExtraOptions: append([]panelstore.SSHOption(nil), host.ExtraOptions...)}
}

func hostByAlias(hosts []panelstore.PanelHost, alias string) (panelstore.PanelHost, bool) {
	for _, host := range hosts {
		if host.Alias == alias {
			return host, true
		}
	}
	return panelstore.PanelHost{}, false
}

func replacePanelHost(hosts []panelstore.PanelHost, replacement panelstore.PanelHost) []panelstore.PanelHost {
	for i := range hosts {
		if hosts[i].Alias == replacement.Alias {
			hosts[i] = replacement
			return hosts
		}
	}
	return append(hosts, replacement)
}

func panelFile(files []panelstore.ConfigFile, path string) (panelstore.ConfigFile, bool) {
	for _, file := range files {
		if file.Path == path {
			return file, true
		}
	}
	return panelstore.ConfigFile{}, false
}

func replaceConfigFile(files []panelsync.ConfigFile, replacement panelsync.ConfigFile) []panelsync.ConfigFile {
	for i := range files {
		if files[i].Path == replacement.Path {
			files[i] = replacement
			return files
		}
	}
	return append(files, replacement)
}

func (a *App) makePanelConfigDiff(state panelstore.State, current []panelsync.ConfigFile, diff panelsync.ConfigDiff, generated *panelsync.GenerationResult) PanelConfigDiff {
	var generation panelsync.GenerationResult
	if generated != nil {
		generation = *generated
	}
	result := PanelConfigDiff{
		AddedHosts: append([]string(nil), diff.AddedHosts...), RemovedHosts: append([]string(nil), diff.RemovedHosts...), ChangedHosts: append([]string(nil), diff.ChangedHosts...),
		Conflicts: a.publicConfigConflicts(diff.Conflicts, state, state, current),
	}
	result.ChangedFiles = a.makeFileDiff(state, current, generation)
	result.HostDiff = makeHostDiff(state.Hosts, state.Hosts)
	result.HasChanges = diff.HasChanges()
	return result
}

func (a *App) makeFileDiff(state panelstore.State, current []panelsync.ConfigFile, generation panelsync.GenerationResult) []PanelConfigFileDiff {
	panelFiles := make(map[string]panelstore.ConfigFile, len(state.ConfigLayout.Files))
	for _, file := range state.ConfigLayout.Files {
		panelFiles[file.Path] = file
	}
	externalFiles := make(map[string]panelsync.ConfigFile, len(current))
	for _, file := range current {
		externalFiles[file.Path] = file
	}
	hasGeneration := len(generation.Files) > 0 || len(generation.RemovedFiles) > 0 || generation.GeneratedAt != 0
	generatedFiles := make(map[string]panelsync.ConfigFile, len(generation.Files))
	for _, file := range generation.Files {
		generatedFiles[file.Path] = file
	}
	paths := make(map[string]bool)
	for path := range panelFiles {
		paths[path] = true
	}
	for path := range externalFiles {
		paths[path] = true
	}
	for path := range generatedFiles {
		paths[path] = true
	}
	out := make([]PanelConfigFileDiff, 0, len(paths))
	for path := range paths {
		panelFile := panelFiles[path]
		externalFile := externalFiles[path]
		generatedFile := generatedFiles[path]
		panelHash := panelFile.SHA256
		if panelHash == "" && panelFile.Content != "" {
			panelHash = panelstore.SHA256([]byte(panelFile.Content))
		}
		externalHash := externalFile.SHA256
		generatedHash := generatedFile.SHA256
		kind := "unchanged"
		if !okConfigFile(panelFiles, path) && okConfigFile(externalFiles, path) {
			kind = "added"
		} else if okConfigFile(panelFiles, path) && !okConfigFile(externalFiles, path) {
			kind = "removed"
		} else if panelHash != externalHash || (hasGeneration && (externalHash != generatedHash || panelHash != generatedHash)) {
			kind = "changed"
		}
		if kind == "unchanged" {
			continue
		}
		out = append(out, PanelConfigFileDiff{Path: path, Kind: kind, PanelSHA256: panelHash, ExternalSHA256: externalHash, GeneratedSHA256: generatedHash, PanelContent: panelFile.Content, ExternalContent: externalFile.Content, GeneratedContent: generatedFile.Content})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func okConfigFile[T any](files map[string]T, path string) bool {
	_, ok := files[path]
	return ok
}

func makeHostDiff(before, after []panelstore.PanelHost) []PanelHostDiff {
	left := make(map[string]panelstore.PanelHost, len(before))
	right := make(map[string]panelstore.PanelHost, len(after))
	for _, host := range before {
		left[host.Alias] = host
	}
	for _, host := range after {
		right[host.Alias] = host
	}
	aliases := make(map[string]bool)
	for alias := range left {
		aliases[alias] = true
	}
	for alias := range right {
		aliases[alias] = true
	}
	out := make([]PanelHostDiff, 0, len(aliases))
	for alias := range aliases {
		old, oldOK := left[alias]
		next, nextOK := right[alias]
		kind := "changed"
		if !oldOK {
			kind = "added"
		} else if !nextOK {
			kind = "removed"
		}
		if oldOK && nextOK && reflect.DeepEqual(old, next) {
			continue
		}
		fields := changedHostFields(old, next)
		out = append(out, PanelHostDiff{Alias: alias, Kind: kind, Fields: fields, Panel: redactedHostJSON(old, oldOK), Candidate: redactedHostJSON(next, nextOK)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Alias < out[j].Alias })
	return out
}

func changedHostFields(before, after panelstore.PanelHost) []string {
	var fields []string
	if before.HostName != after.HostName {
		fields = append(fields, "HostName")
	}
	if before.User != after.User {
		fields = append(fields, "User")
	}
	if before.Port != after.Port {
		fields = append(fields, "Port")
	}
	if before.Password != after.Password {
		fields = append(fields, "Password")
	}
	if !reflect.DeepEqual(before.IdentityFiles, after.IdentityFiles) {
		fields = append(fields, "IdentityFile")
	}
	if before.ProxyJump != after.ProxyJump {
		fields = append(fields, "ProxyJump")
	}
	if before.ProxyCommand != after.ProxyCommand {
		fields = append(fields, "ProxyCommand")
	}
	if before.IdentityAgent != after.IdentityAgent {
		fields = append(fields, "IdentityAgent")
	}
	if before.ForwardAgent != after.ForwardAgent {
		fields = append(fields, "ForwardAgent")
	}
	if before.HostKeyAlgos != after.HostKeyAlgos {
		fields = append(fields, "HostKeyAlgorithms")
	}
	if !reflect.DeepEqual(before.PortForwards, after.PortForwards) {
		fields = append(fields, "PortForward")
	}
	if before.Note != after.Note {
		fields = append(fields, "Note")
	}
	if before.GroupID != after.GroupID {
		fields = append(fields, "Group")
	}
	if before.Order != after.Order {
		fields = append(fields, "Order")
	}
	if !reflect.DeepEqual(before.ExtraOptions, after.ExtraOptions) {
		fields = append(fields, "ExtraOptions")
	}
	return fields
}

func redactedHostJSON(host panelstore.PanelHost, ok bool) string {
	if !ok {
		return ""
	}
	host.Password = maskedPassword(host.Password)
	b, _ := json.MarshalIndent(host, "", "  ")
	return string(b)
}

func (a *App) publicConfigConflicts(conflicts []string, panel, external panelstore.State, files []panelsync.ConfigFile) []PanelConfigConflict {
	result := make([]PanelConfigConflict, 0, len(conflicts))
	for _, summary := range conflicts {
		conflict := PanelConfigConflict{ID: uuid.NewString(), Kind: "config", Summary: summary}
		if strings.HasPrefix(summary, "Host ") {
			rest := strings.TrimPrefix(summary, "Host ")
			if space := strings.IndexByte(rest, ' '); space >= 0 {
				conflict.Alias = rest[:space]
			}
			if strings.Contains(summary, "从 SSH 配置消失") {
				conflict.Kind = "host-removed"
				conflict.Panel = redactedHostJSON(hostForAlias(panel.Hosts, conflict.Alias), true)
			} else {
				conflict.Kind = "host-duplicate"
				conflict.Panel = redactedHostJSON(hostForAlias(panel.Hosts, conflict.Alias), true)
				conflict.External = redactedHostJSON(hostForAlias(external.Hosts, conflict.Alias), true)
			}
		} else if strings.HasPrefix(summary, "文件 ") {
			conflict.Kind = "file"
			rest := strings.TrimPrefix(summary, "文件 ")
			if end := strings.Index(rest, " 包含"); end >= 0 {
				conflict.File = rest[:end]
			}
			if file, ok := panelFile(panel.ConfigLayout.Files, conflict.File); ok {
				conflict.Panel = file.Content
			}
		}
		result = append(result, conflict)
	}
	return result
}

func (a *App) driftConflicts(panel panelstore.State, current []panelsync.ConfigFile, diff panelsync.ConfigDiff) []PanelConfigConflict {
	conflicts := a.publicConfigConflicts(diff.Conflicts, panel, panel, current)
	for _, path := range diff.ChangedFiles {
		conflicts = append(conflicts, PanelConfigConflict{ID: uuid.NewString(), Kind: "external-drift", File: path, Summary: fmt.Sprintf("文件 %s 在草稿期间被外部修改", path)})
	}
	return conflicts
}

func filesToPanelFiles(files []panelstore.ConfigFile) []panelsync.ConfigFile {
	out := make([]panelsync.ConfigFile, 0, len(files))
	for _, file := range files {
		out = append(out, panelsync.ConfigFile{Path: file.Path, Content: file.Content, Mode: file.Mode, SHA256: file.SHA256})
	}
	return out
}

func hostForAlias(hosts []panelstore.PanelHost, alias string) panelstore.PanelHost {
	host, _ := hostByAlias(hosts, alias)
	return host
}

func countIncludeFiles(files []panelsync.ConfigFile) int {
	if len(files) <= 1 {
		return 0
	}
	return len(files) - 1
}

func configFilesHash(files []panelsync.ConfigFile) string {
	ordered := append([]panelsync.ConfigFile(nil), files...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Path < ordered[j].Path })
	h := sha256.New()
	for _, file := range ordered {
		_, _ = io.WriteString(h, file.Path)
		_, _ = h.Write([]byte{0})
		contentHash := panelstore.SHA256([]byte(file.Content))
		if file.Content == "" && file.SHA256 != "" {
			contentHash = file.SHA256
		}
		_, _ = io.WriteString(h, contentHash)
		_, _ = h.Write([]byte{0})
		_, _ = io.WriteString(h, fmt.Sprintf("%d", file.Mode))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func fileUpdatedAt(info os.FileInfo, err error) int64 {
	if err != nil || info == nil {
		return 0
	}
	return info.ModTime().Unix()
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err == nil && info != nil && info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	return total
}

func safeConfigRelative(path string) bool {
	clean := filepath.Clean(filepath.FromSlash(path))
	return clean != "." && clean != "" && !filepath.IsAbs(path) && clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
}
