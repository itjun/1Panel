package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"diteng-pannel/internal/windowmaterial"
)

type WindowThemeState struct {
	Preference string `json:"preference"`
	Effective  string `json:"effective"`
	Supported  bool   `json:"supported"`
	Reason     string `json:"reason"`
	Revision   uint64 `json:"revision"`
}

// One owner serializes persistence and native changes. Platform functions are injectable
// so fallback/persistence can be tested without starting a window or touching real preferences.
type windowThemeManager struct {
	mu         sync.Mutex
	state      WindowThemeState
	path       string
	automatic  string
	capability func(string) (bool, string)
	apply      func(string) error
}

func validWindowMaterial(value string) bool {
	return value == "auto" || value == "classic" || value == "acrylic" || value == "mica"
}

func windowThemePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "ServerPanel", "theme.json")
}

func loadWindowMaterial(path string) string {
	var saved struct {
		Material string `json:"material"`
	}
	data, err := os.ReadFile(path)
	if err == nil && json.Unmarshal(data, &saved) == nil && validWindowMaterial(saved.Material) {
		return saved.Material
	}
	return "auto"
}

func saveWindowMaterial(path, preference string) error {
	if path == "" {
		return fmt.Errorf("无法访问主题配置目录")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(struct {
		Material string `json:"material"`
	}{preference})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".theme-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}

func newWindowThemeManager(path, automatic string, capability func(string) (bool, string), apply func(string) error) *windowThemeManager {
	return &windowThemeManager{
		path: path, automatic: automatic, capability: capability, apply: apply,
		state: WindowThemeState{Preference: loadWindowMaterial(path), Effective: "classic", Reason: "正在准备窗口材质"},
	}
}

func (m *windowThemeManager) snapshot() WindowThemeState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

func (m *windowThemeManager) refreshLocked(forceClassic bool) WindowThemeState {
	next := WindowThemeState{Preference: m.state.Preference, Effective: "classic"}
	requested := next.Preference
	if requested == "auto" || requested == "classic" {
		requested = m.automatic
	}
	next.Supported, next.Reason = m.capability(requested)
	if next.Preference == "classic" {
		next.Reason = ""
	}
	if forceClassic {
		next.Reason = "窗口材质初始化超时，正在使用经典外观"
	} else if next.Supported && next.Preference != "classic" {
		next.Effective = requested
	}
	if err := m.apply(next.Effective); err != nil {
		next.Effective = "classic"
		next.Supported = false
		next.Reason = err.Error()
		// Roll back any partially enabled native backdrop.
		_ = m.apply("classic")
	}
	next.Revision = m.state.Revision
	if next != m.state {
		next.Revision++
	}
	m.state = next
	return next
}

func (m *windowThemeManager) refresh(forceClassic bool) WindowThemeState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.refreshLocked(forceClassic)
}

func (m *windowThemeManager) set(preference string) (WindowThemeState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !validWindowMaterial(preference) {
		return m.state, fmt.Errorf("无效的窗口材质")
	}
	// Save first: a write failure must not change either the preference or the window.
	if err := saveWindowMaterial(m.path, preference); err != nil {
		return m.state, fmt.Errorf("保存窗口材质失败：%w", err)
	}
	m.state.Preference = preference
	m.state.Revision++
	return m.refreshLocked(false), nil
}

func (s *System) GetWindowThemeState() WindowThemeState {
	return s.windowTheme.refresh(false)
}

func (s *System) SetWindowMaterial(preference string) (WindowThemeState, error) {
	state, err := s.windowTheme.set(preference)
	if err == nil {
		s.app.Event.Emit("window-theme-changed", state)
	}
	return state, err
}

// WindowThemeReady acknowledges the revision whose CSS has actually been painted.
func (s *System) WindowThemeReady(revision uint64) bool {
	state := s.windowTheme.snapshot()
	if state.Revision != revision || state.Reason == "窗口尚未就绪" {
		return false
	}
	s.showMu.Lock()
	s.themeStartupReady = true
	s.showMu.Unlock()
	(*App)(s).maybeShowMainWindow()
	return true
}

func (a *App) startWindowTheme() {
	// AppKit's application-started callback runs on the UI thread; native changes
	// and their mutex are owned by workers to avoid dispatch_sync deadlocks.
	go func() {
		state := a.windowTheme.refresh(false)
		a.app.Event.Emit("window-theme-changed", state)
		stop := windowmaterial.Observe(func() {
			state := a.windowTheme.refresh(false)
			a.app.Event.Emit("window-theme-changed", state)
		})
		a.themeObserverMu.Lock()
		stopped := a.themeStopped
		if !stopped {
			a.stopThemeObserver = stop
		}
		a.themeObserverMu.Unlock()
		if stopped {
			stop()
		}
	}()
	a.showMu.Lock()
	a.themeStartupTimer = time.AfterFunc(1500*time.Millisecond, func() {
		a.showMu.Lock()
		acknowledged := a.themeStartupReady
		a.showMu.Unlock()
		if acknowledged {
			return
		}
		state := a.windowTheme.refresh(true)
		a.app.Event.Emit("window-theme-changed", state)
		// The static skeleton is already classic. Restore that CSS too if the
		// frontend started but could not finish its ready handshake.
		a.mainWindow.ExecJS("document.documentElement.dataset.windowMaterial='classic';document.documentElement.style.background='var(--color-canvas)';")
		a.showMu.Lock()
		a.themeStartupReady = true
		a.showMu.Unlock()
		a.maybeShowMainWindow()
	})
	a.showMu.Unlock()
}
