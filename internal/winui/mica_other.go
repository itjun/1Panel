//go:build !windows

package winui

import "github.com/wailsapp/wails/v3/pkg/application"

// SetWindowMica 非 Windows 无操作。
func SetWindowMica(win *application.WebviewWindow, on bool) bool { return false }
