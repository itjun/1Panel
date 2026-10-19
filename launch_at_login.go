package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type LaunchAtLoginState struct {
	Enabled   bool   `json:"enabled"`
	Supported bool   `json:"supported"`
	Reason    string `json:"reason"`
}

type loginStartup interface {
	Enable() error
	Disable() error
	IsEnabled() (bool, error)
}

// The OS owns the setting. This marker only records that the default has been
// applied, so a later app launch never reverses an opt-out in System Settings.
type launchAtLoginManager struct {
	mu       sync.Mutex
	startup  loginStartup
	path     string
	reason   string
	expected *bool
}

func launchAtLoginPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "ServerPanel", "launch-at-login.initialized")
}

func (m *launchAtLoginManager) initialize() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.startup == nil {
		return nil
	}
	if m.path == "" {
		m.reason = "无法访问开机启动配置目录"
		return fmt.Errorf("%s", m.reason)
	}
	if _, err := os.Stat(m.path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		m.reason = "读取开机启动配置失败：" + err.Error()
		return fmt.Errorf("%s", m.reason)
	}
	enabled, err := m.startup.IsEnabled()
	if err != nil {
		m.reason = "读取开机启动状态失败：" + err.Error()
		return fmt.Errorf("%s", m.reason)
	}
	if enabled {
		return m.markInitialized()
	}
	_, err = m.setLocked(true)
	return err
}

func (m *launchAtLoginManager) snapshotLocked() (LaunchAtLoginState, error) {
	state := LaunchAtLoginState{Supported: m.startup != nil, Reason: m.reason}
	if m.startup == nil {
		return state, nil
	}
	enabled, err := m.startup.IsEnabled()
	if err != nil {
		return state, fmt.Errorf("读取开机启动状态失败：%w", err)
	}
	state.Enabled = enabled
	if m.expected != nil && enabled == *m.expected {
		m.reason, m.expected = "", nil
		state.Reason = ""
	}
	return state, nil
}

func (m *launchAtLoginManager) snapshot() (LaunchAtLoginState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

func (m *launchAtLoginManager) set(enabled bool) (LaunchAtLoginState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.setLocked(enabled)
}

func (m *launchAtLoginManager) setLocked(enabled bool) (LaunchAtLoginState, error) {
	if m.startup == nil {
		return LaunchAtLoginState{Reason: m.reason}, fmt.Errorf("%s", m.reason)
	}
	// Persist before changing the OS: a failed write must not cause the next
	// launch to re-enable startup after the user explicitly turned it off.
	if err := m.markInitialized(); err != nil {
		m.reason = "保存开机启动设置失败：" + err.Error()
		return LaunchAtLoginState{}, fmt.Errorf("%s", m.reason)
	}
	m.reason, m.expected = "", &enabled
	var err error
	if enabled {
		err = m.startup.Enable()
	} else {
		err = m.startup.Disable()
	}
	if err != nil {
		m.reason = "更改开机启动失败：" + err.Error()
		return LaunchAtLoginState{}, fmt.Errorf("%s", m.reason)
	}
	state, err := m.snapshotLocked()
	if err == nil && state.Enabled != enabled {
		m.reason = "系统尚未应用此设置，请在系统的登录项或启动应用设置中检查 1Panel 后重试"
		state.Reason = m.reason
	}
	return state, err
}

func (m *launchAtLoginManager) markInitialized() error {
	if m.path == "" {
		return fmt.Errorf("无法访问配置目录")
	}
	if err := os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(m.path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if os.IsExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return f.Close()
}

func (s *System) GetLaunchAtLoginState() (LaunchAtLoginState, error) {
	if s.launchAtLogin == nil {
		return LaunchAtLoginState{Reason: "当前运行环境不支持开机启动"}, nil
	}
	return s.launchAtLogin.snapshot()
}

func (s *System) SetLaunchAtLogin(enabled bool) (LaunchAtLoginState, error) {
	if s.launchAtLogin == nil {
		return LaunchAtLoginState{}, fmt.Errorf("当前运行环境不支持开机启动")
	}
	return s.launchAtLogin.set(enabled)
}
