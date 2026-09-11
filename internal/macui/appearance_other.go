//go:build !darwin

package macui

import "github.com/wailsapp/wails/v3/pkg/application"

// AppearanceMode 窗口外观模式，与前端 ThemeKey 对齐。
type AppearanceMode string

const (
	AppearanceAuto  AppearanceMode = "auto"
	AppearanceLight AppearanceMode = "light"
	AppearanceDark  AppearanceMode = "dark"
)

// SetWindowAppearance 非 macOS 无操作。
func SetWindowAppearance(win *application.WebviewWindow, mode AppearanceMode) {}

// StartSystemAppearanceObserver 非 macOS 无操作。
func StartSystemAppearanceObserver(cb func(dark bool)) {}

// StopSystemAppearanceObserver 非 macOS 无操作。
func StopSystemAppearanceObserver() {}

// SystemAppearanceIsDark 非 macOS 返回 false。
func SystemAppearanceIsDark() bool { return false }
