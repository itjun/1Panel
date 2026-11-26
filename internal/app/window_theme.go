package app

import (
	"sync"
	"time"

	"diteng-pannel/internal/windowmaterial"
)

type WindowThemeState struct {
	Effective string `json:"effective"`
	Supported bool   `json:"supported"`
	Reason    string `json:"reason"`
	Revision  uint64 `json:"revision"`
}

// System capability and accessibility changes determine the effective native material.
type windowThemeManager struct {
	mu         sync.Mutex
	state      WindowThemeState
	candidates []string
	capability func(string) (bool, string)
	apply      func(string) error
}

func newWindowThemeManager(candidates []string, capability func(string) (bool, string), apply func(string) error) *windowThemeManager {
	return &windowThemeManager{
		candidates: candidates, capability: capability, apply: apply,
		state: WindowThemeState{Effective: "classic", Reason: "正在准备窗口材质"},
	}
}

func (m *windowThemeManager) snapshot() WindowThemeState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

func (m *windowThemeManager) refresh(forceClassic bool) WindowThemeState {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := WindowThemeState{Effective: "classic"}
	reason := ""
	chosen := false
	if forceClassic {
		reason = "窗口材质初始化超时，正在使用经典外观"
	} else {
		// 按平台顺序尝试。Windows 为云母、半透明，再落到实色。
		for _, material := range m.candidates {
			ok, why := m.capability(material)
			if !ok {
				if reason == "" {
					reason = why
				}
				continue
			}
			if err := m.apply(material); err != nil {
				reason = err.Error()
				_ = m.apply("classic")
				continue
			}
			next.Effective = material
			next.Supported = true
			chosen = true
			break
		}
	}
	if !chosen {
		if reason == "" {
			reason = "当前系统使用经典外观"
		}
		next.Reason = reason
		if err := m.apply("classic"); err != nil {
			next.Reason = err.Error()
		}
	}
	next.Revision = m.state.Revision
	if next != m.state {
		next.Revision++
	}
	m.state = next
	return next
}

func (s *System) GetWindowThemeState() WindowThemeState {
	return s.windowTheme.refresh(false)
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
