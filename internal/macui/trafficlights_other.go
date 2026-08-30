//go:build !darwin

package macui

import "github.com/wailsapp/wails/v3/pkg/application"

// InstallCenteredTrafficLights 非 macOS 无操作。
func InstallCenteredTrafficLights(win *application.WebviewWindow, titleBarHeight int) {}

// ApplyCenteredTrafficLights 非 macOS 无操作。
func ApplyCenteredTrafficLights(win *application.WebviewWindow) {}
