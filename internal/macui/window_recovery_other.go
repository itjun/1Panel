//go:build !darwin

package macui

import "github.com/wailsapp/wails/v3/pkg/application"

// InstallDisplayRecovery 非 macOS 无操作。
func InstallDisplayRecovery(win *application.WebviewWindow) {}
