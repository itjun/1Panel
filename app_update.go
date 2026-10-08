package main

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/desktop"
	"diteng-pannel/internal/updater"
)

// updateBaseURL 更新清单基地址，发布构建经 -ldflags -X 注入；为空时不检查更新。
// 环境变量 ONEPANEL_UPDATE_BASE_URL 可覆盖（本地联调用；清单仍须通过内置公钥验签）。
var updateBaseURL = ""

const (
	updateFirstCheckDelay = 10 * time.Second
	updateCheckInterval   = 6 * time.Hour
	updateCheckJitter     = 10 * time.Minute
	updateRemindLater     = 24 * time.Hour
	updateFetchTimeout    = 20 * time.Second
	updatePokeMinInterval = 10 * time.Minute
)

// 更新状态机：idle → checking → idle；idle → downloading → installing →（重启）；任一步失败 → error。
const (
	updateIdle        = "idle"
	updateChecking    = "checking"
	updateDownloading = "downloading"
	updateInstalling  = "installing"
	updateError       = "error"
)

// AppUpdate 应用内更新服务（前端绑定）。
type AppUpdate App

// UpdateState 推送给前端的更新状态快照。
type UpdateState struct {
	Enabled        bool   `json:"enabled"`
	DisabledReason string `json:"disabledReason"`
	DevBuild       bool   `json:"devBuild"`
	Current        string `json:"current"`
	Status         string `json:"status"`
	HasUpdate      bool   `json:"hasUpdate"`
	Mandatory      bool   `json:"mandatory"`
	Latest         string `json:"latest"`
	MinSupported   string `json:"minSupported"`
	Notes          string `json:"notes"`
	ReleasedAt     string `json:"releasedAt"`
	Size           int64  `json:"size"`
	Downloaded     int64  `json:"downloaded"`
	Total          int64  `json:"total"`
	Error          string `json:"error"`
	LastChecked    string `json:"lastChecked"`
	// ReleaseURL 发布页地址；连不上更新源时引导用户手动下载。
	ReleaseURL string `json:"releaseUrl"`
	// CheckFailed 上次自动检查连不上更新源（网络错误）；恢复成功后清除。
	CheckFailed bool `json:"checkFailed"`
	// Prompt 后端判定应主动弹窗（强制更新，或未被跳过 / 推迟的可选更新）。
	Prompt         bool   `json:"prompt"`
	AutoCheck      bool   `json:"autoCheck"`
	SkippedVersion string `json:"skippedVersion"`
}

type updatePrefs struct {
	AutoCheck      bool      `json:"autoCheck"`
	SkippedVersion string    `json:"skippedVersion,omitempty"`
	RemindVersion  string    `json:"remindVersion,omitempty"`
	RemindAfter    time.Time `json:"remindAfter,omitempty"`
}

type updateController struct {
	app     *App
	client  *updater.Client
	current string // 可比较的当前版本（开发构建为基础 tag）
	dev     bool

	mu       sync.Mutex
	prefs    updatePrefs
	state    UpdateState
	manifest *updater.Manifest
	cancel   context.CancelFunc
	started  bool

	lastAttempt     time.Time // 最近一次检查尝试（含失败），poke 节流用
	netFailNotified bool      // 本次运行内连不上更新源已提示过，避免每轮轮询都打扰
}

func updateDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "ServerPanel", "update")
}

func newUpdateController(a *App) *updateController {
	c := &updateController{app: a}
	c.prefs = loadUpdatePrefs()

	baseURL := strings.TrimSpace(updateBaseURL)
	rawVersion := resolveAppVersion()
	if v := strings.TrimSpace(os.Getenv("ONEPANEL_UPDATE_BASE_URL")); v != "" {
		baseURL = v
		if cur := strings.TrimSpace(os.Getenv("ONEPANEL_UPDATE_CURRENT_VERSION")); cur != "" {
			rawVersion = cur
		}
	}
	base, dev, ok := updater.ParseCurrent(rawVersion)
	c.current, c.dev = base, dev

	pub, _ := updater.DecodePublicKey(updater.DefaultPublicKey)
	c.client = &updater.Client{BaseURL: baseURL, PublicKey: pub, Dir: updateDir()}

	c.state = UpdateState{
		Enabled:        true,
		DevBuild:       dev,
		Current:        rawVersion,
		Status:         updateIdle,
		AutoCheck:      c.prefs.AutoCheck,
		SkippedVersion: c.prefs.SkippedVersion,
		ReleaseURL:     strings.TrimSuffix(baseURL, "/download"),
	}
	switch supported, reason := updater.Supported(); {
	case baseURL == "":
		c.state.Enabled, c.state.DisabledReason = false, "此构建未配置更新源"
	case pub == nil:
		c.state.Enabled, c.state.DisabledReason = false, "此构建未内置验签公钥"
	case !ok:
		c.state.Enabled, c.state.DisabledReason = false, "开发构建无法比较版本"
	case updater.CurrentPlatformKey() == "":
		c.state.Enabled, c.state.DisabledReason = false, "当前平台暂不支持自动更新"
	case !supported:
		c.state.Enabled, c.state.DisabledReason = false, reason
	}
	return c
}

func loadUpdatePrefs() updatePrefs {
	p := updatePrefs{AutoCheck: true}
	dir := updateDir()
	if dir == "" {
		return p
	}
	b, err := os.ReadFile(filepath.Join(dir, "prefs.json"))
	if err != nil {
		return p
	}
	_ = json.Unmarshal(b, &p)
	return p
}

func (c *updateController) savePrefsLocked() {
	dir := updateDir()
	if dir == "" {
		return
	}
	_ = os.MkdirAll(dir, 0o755)
	b, err := json.MarshalIndent(c.prefs, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(dir, "prefs.json"), b, 0o644)
}

// start 在 ApplicationStarted 后调用：清理上次更新残留，用缓存清单先做强制拦截，再进入定时检查。
func (c *updateController) start() {
	c.mu.Lock()
	if c.started {
		c.mu.Unlock()
		return
	}
	c.started = true
	enabled := c.state.Enabled
	c.mu.Unlock()

	go updater.Cleanup()
	if !enabled {
		return
	}
	if m, err := c.client.LoadCached(); err == nil {
		c.mu.Lock()
		c.applyManifestLocked(m)
		mandatory := c.state.Mandatory
		if mandatory {
			c.state.Prompt = true
		}
		c.mu.Unlock()
		if mandatory {
			c.announce()
		}
	}
	if c.dev {
		return
	}
	go func() {
		time.Sleep(updateFirstCheckDelay)
		for {
			_, _ = c.check(false)
			jitter := time.Duration(rand.Int64N(int64(2*updateCheckJitter))) - updateCheckJitter
			time.Sleep(updateCheckInterval + jitter)
		}
	}()
}

// applyManifestLocked 用清单刷新版本相关字段。
func (c *updateController) applyManifestLocked(m *updater.Manifest) {
	c.manifest = m
	d := updater.Evaluate(c.current, c.dev, m)
	c.state.HasUpdate = d.HasUpdate
	c.state.Mandatory = d.Mandatory
	c.state.Latest = m.Version
	c.state.MinSupported = m.MinSupportedVersion
	c.state.Notes = m.Notes
	c.state.ReleasedAt = m.ReleasedAt
	c.state.Size = 0
	if a, ok := m.AssetFor(updater.CurrentPlatformKey()); ok {
		c.state.Size = a.Size
	}
	if !d.HasUpdate {
		c.state.Prompt = false
	}
}

// shouldPromptLocked 自动检查时是否主动弹窗。
func (c *updateController) shouldPromptLocked() bool {
	if !c.state.HasUpdate {
		return false
	}
	if c.state.Mandatory {
		return true
	}
	if !c.prefs.AutoCheck || c.prefs.SkippedVersion == c.state.Latest {
		return false
	}
	if c.prefs.RemindVersion == c.state.Latest && time.Now().Before(c.prefs.RemindAfter) {
		return false
	}
	return true
}

// check 拉取清单并刷新状态。manual=true 为用户手动检查：失败时返回错误，弹窗由前端决定。
func (c *updateController) check(manual bool) (UpdateState, error) {
	c.mu.Lock()
	if !c.state.Enabled {
		st := c.state
		c.mu.Unlock()
		if manual {
			return st, errors.New(st.DisabledReason)
		}
		return st, nil
	}
	if c.state.Status == updateDownloading || c.state.Status == updateInstalling || c.state.Status == updateChecking {
		st := c.state
		c.mu.Unlock()
		return st, nil
	}
	prevStatus := c.state.Status
	c.state.Status = updateChecking
	c.lastAttempt = time.Now()
	c.mu.Unlock()
	c.emitState()

	ctx, cancel := context.WithTimeout(context.Background(), updateFetchTimeout)
	m, err := c.client.Fetch(ctx)
	cancel()

	c.mu.Lock()
	c.state.Status = updateIdle
	if err != nil {
		// 自动检查失败时保留上次下载失败的提示
		if prevStatus == updateError && !manual {
			c.state.Status = updateError
		}
		if manual {
			c.state.Error = err.Error()
		}
		// 连不上更新源：记录在状态里（设置页展示），并按需引导手动下载
		unreachable := !manual && isFetchUnreachable(err)
		if unreachable {
			c.state.Error = err.Error()
			c.state.CheckFailed = true
		}
		// 同一次运行内只对「连不上」弹一次引导，之后的轮询失败保持静默
		notifyFail := unreachable && !c.netFailNotified
		if notifyFail {
			c.netFailNotified = true
		}
		st := c.state
		c.mu.Unlock()
		c.emitState()
		if notifyFail {
			c.announceCheckFailed(st)
		}
		return st, err
	}
	c.state.Error = ""
	c.state.CheckFailed = false
	c.netFailNotified = false
	c.state.LastChecked = time.Now().Format(time.RFC3339)
	c.applyManifestLocked(m)
	prompt := false
	if !manual && c.shouldPromptLocked() {
		c.state.Prompt = true
		prompt = true
	}
	if c.state.Mandatory {
		c.state.Prompt = true
		prompt = true
	}
	st := c.state
	c.mu.Unlock()
	c.emitState()
	if prompt {
		c.announce()
	}
	return st, nil
}

// announce 通知前端弹窗；主窗口不可见时补一条系统通知。
func (c *updateController) announce() {
	c.mu.Lock()
	st := c.state
	c.mu.Unlock()
	if app := c.app.app; app != nil {
		app.Event.Emit("update-available", st)
	}
	if c.mainWindowVisible() {
		return
	}
	title := "1Panel 有新版本 " + st.Latest
	body := "点击查看更新内容并安装。"
	if st.Mandatory {
		title = "1Panel 需要更新到 " + st.Latest
		body = "当前版本已停止支持，请更新后继续使用。"
	}
	_ = desktop.Notify(desktop.Payload{
		Title:   title,
		Body:    body,
		EventID: "update-" + st.Latest,
		Kind:    "update",
	})
}

// announceCheckFailed 连不上更新源时引导用户去发布页手动下载。
// 主窗口不可见时补系统通知（点击走 kind=update 的 update-show 路径）。
func (c *updateController) announceCheckFailed(st UpdateState) {
	if app := c.app.app; app != nil {
		app.Event.Emit("update-check-failed", st)
	}
	if c.mainWindowVisible() {
		return
	}
	_ = desktop.Notify(desktop.Payload{
		Title:   "无法检查应用更新",
		Body:    "连接更新服务器失败，可到发布页手动下载新版本。",
		EventID: "update-check-failed",
		Kind:    "update",
	})
}

// isFetchUnreachable 判定失败是否属于「连不上更新源」（超时 / 连接失败 / DNS
// 等网络错误）。HTTP 状态码异常或验签失败是源配置问题，不引导手动下载。
func isFetchUnreachable(err error) bool {
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	return errors.Is(err, context.DeadlineExceeded)
}

// poke 前端窗口重新可见 / 聚焦时调用：尽快补一次检查，弥补 6 小时轮询的
// 滞后（应用挂在托盘数小时后恢复，能立刻看到新版本提示）。
// 距上次尝试不足 updatePokeMinInterval 则跳过；下载 / 安装中不打扰。
func (c *updateController) poke() {
	c.mu.Lock()
	if !c.state.Enabled || c.dev || !c.prefs.AutoCheck || !c.started {
		c.mu.Unlock()
		return
	}
	switch c.state.Status {
	case updateChecking, updateDownloading, updateInstalling:
		c.mu.Unlock()
		return
	}
	if !c.lastAttempt.IsZero() && time.Since(c.lastAttempt) < updatePokeMinInterval {
		c.mu.Unlock()
		return
	}
	c.lastAttempt = time.Now()
	c.mu.Unlock()
	go func() {
		_, _ = c.check(false)
	}()
}

func (c *updateController) mainWindowVisible() bool {
	a := c.app
	a.showMu.Lock()
	ready := a.ready && a.shown
	win := a.mainWindow
	a.showMu.Unlock()
	if win == nil || !ready {
		return false
	}
	return win.IsVisible() && !win.IsMinimised()
}

func (c *updateController) emitState() {
	c.mu.Lock()
	st := c.state
	c.mu.Unlock()
	if app := c.app.app; app != nil {
		app.Event.Emit("update-state", st)
	}
}

func (c *updateController) snapshot() UpdateState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// startUpdate 后台下载、校验、替换，成功后重启。
func (c *updateController) startUpdate() error {
	c.mu.Lock()
	if !c.state.Enabled {
		c.mu.Unlock()
		return errors.New(c.state.DisabledReason)
	}
	if c.state.Status == updateDownloading || c.state.Status == updateInstalling {
		c.mu.Unlock()
		return nil
	}
	if !c.state.HasUpdate || c.manifest == nil {
		c.mu.Unlock()
		return errors.New("当前已是最新版本")
	}
	asset, ok := c.manifest.AssetFor(updater.CurrentPlatformKey())
	if !ok {
		c.mu.Unlock()
		return errors.New("新版本没有当前平台的安装包")
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	c.state.Status = updateDownloading
	c.state.Error = ""
	c.state.Downloaded = 0
	c.state.Total = asset.Size
	c.mu.Unlock()
	c.emitState()

	go c.runUpdate(ctx, asset)
	return nil
}

func (c *updateController) runUpdate(ctx context.Context, asset updater.Asset) {
	path, err := c.client.Download(ctx, asset, func(done, total int64) {
		c.mu.Lock()
		c.state.Downloaded, c.state.Total = done, total
		c.mu.Unlock()
		c.emitState()
	})
	if err == nil {
		c.client.PruneDownloads(filepath.Base(path))
		c.mu.Lock()
		c.state.Status = updateInstalling
		c.mu.Unlock()
		c.emitState()
		err = updater.Apply(path)
	}

	c.mu.Lock()
	c.cancel = nil
	if err != nil {
		if errors.Is(err, context.Canceled) {
			c.state.Status = updateIdle
			c.state.Error = ""
		} else {
			c.state.Status = updateError
			c.state.Error = err.Error()
		}
		c.mu.Unlock()
		c.emitState()
		return
	}
	c.mu.Unlock()
	c.app.app.Logger.Info("更新已安装，正在重启", "version", asset.Name)
	time.Sleep(500 * time.Millisecond)
	c.app.restartApp()
}

func (c *updateController) cancelUpdate() {
	c.mu.Lock()
	cancel := c.cancel
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (c *updateController) skipVersion(version string) error {
	c.mu.Lock()
	if c.state.Mandatory {
		c.mu.Unlock()
		return errors.New("强制更新不能跳过")
	}
	c.prefs.SkippedVersion = updater.Canonical(version)
	c.state.SkippedVersion = c.prefs.SkippedVersion
	c.state.Prompt = false
	c.savePrefsLocked()
	c.mu.Unlock()
	c.emitState()
	return nil
}

func (c *updateController) remindLater() error {
	c.mu.Lock()
	if c.state.Mandatory {
		c.mu.Unlock()
		return errors.New("强制更新不能推迟")
	}
	c.prefs.RemindVersion = c.state.Latest
	c.prefs.RemindAfter = time.Now().Add(updateRemindLater)
	c.state.Prompt = false
	c.savePrefsLocked()
	c.mu.Unlock()
	c.emitState()
	return nil
}

func (c *updateController) setAutoCheck(on bool) {
	c.mu.Lock()
	c.prefs.AutoCheck = on
	c.state.AutoCheck = on
	c.savePrefsLocked()
	c.mu.Unlock()
	c.emitState()
}

// ============ 前端绑定 ============

// GetUpdateState 返回当前更新状态。
func (u *AppUpdate) GetUpdateState() UpdateState {
	return (*App)(u).updates.snapshot()
}

// CheckUpdate 立即检查更新（设置页「检查更新」）。
func (u *AppUpdate) CheckUpdate() (UpdateState, error) {
	return (*App)(u).updates.check(true)
}

// PokeUpdateCheck 窗口重新可见 / 聚焦时请求尽快补一次检查（后端节流，
// 距上次尝试不足 10 分钟则跳过）。
func (u *AppUpdate) PokeUpdateCheck() {
	(*App)(u).updates.poke()
}

// StartUpdate 开始下载并安装新版本，完成后自动重启。
func (u *AppUpdate) StartUpdate() error {
	return (*App)(u).updates.startUpdate()
}

// CancelUpdate 取消正在进行的下载。
func (u *AppUpdate) CancelUpdate() {
	(*App)(u).updates.cancelUpdate()
}

// SkipVersion 不再提醒该版本（仅可选更新）。
func (u *AppUpdate) SkipVersion(version string) error {
	return (*App)(u).updates.skipVersion(version)
}

// RemindLater 24 小时内不再提醒当前版本（仅可选更新）。
func (u *AppUpdate) RemindLater() error {
	return (*App)(u).updates.remindLater()
}

// SetAutoCheck 开关自动检查更新；强制更新不受影响。
func (u *AppUpdate) SetAutoCheck(on bool) {
	(*App)(u).updates.setAutoCheck(on)
}
