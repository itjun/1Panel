//go:build !darwin

package macui

import "github.com/wailsapp/wails/v3/pkg/application"

// EnableFrostedBackdrop 非 macOS 无系统磨砂。
func EnableFrostedBackdrop(win *application.WebviewWindow) {}
