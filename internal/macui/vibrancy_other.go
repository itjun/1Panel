//go:build !darwin

package macui

import "github.com/wailsapp/wails/v3/pkg/application"

// EnableFrostedBackdrop 已停用：主窗口改为不透明白底，非 macOS 亦无系统磨砂。
func EnableFrostedBackdrop(win *application.WebviewWindow) {}
