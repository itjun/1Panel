//go:build !windows

package winui

import "github.com/wailsapp/wails/v3/pkg/application"

// SetHiddenOnTaskbar 非 Windows 无任务栏按钮，无操作。
func SetHiddenOnTaskbar(win *application.WebviewWindow, hidden bool) {}
