//go:build !darwin

package macui

import "github.com/wailsapp/wails/v3/pkg/application"

// SetWindowFrosted 非 macOS 无操作。
func SetWindowFrosted(win *application.WebviewWindow, frosted bool) {}
