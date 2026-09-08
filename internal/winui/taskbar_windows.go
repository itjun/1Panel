//go:build windows

package winui

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

// SetHiddenOnTaskbar 从任务栏隐藏/恢复窗口（托盘后台挂起用）。
// 隐藏：WS_EX_TOOLWINDOW；恢复：WS_EX_APPWINDOW。须在 Hide 之后 / Show 之前调用。
func SetHiddenOnTaskbar(win *application.WebviewWindow, hidden bool) {
	if win == nil {
		return
	}
	application.InvokeSync(func() {
		hwnd := w32.HWND(uintptr(win.NativeWindow()))
		if hwnd == 0 {
			return
		}
		ex := uint32(w32.GetWindowLong(hwnd, w32.GWL_EXSTYLE))
		if hidden {
			ex |= w32.WS_EX_TOOLWINDOW
			ex &^= w32.WS_EX_APPWINDOW
		} else {
			ex |= w32.WS_EX_APPWINDOW
			ex &^= w32.WS_EX_TOOLWINDOW
		}
		w32.SetWindowLong(hwnd, w32.GWL_EXSTYLE, ex)
		w32.SetWindowPos(hwnd, 0, 0, 0, 0, 0,
			w32.SWP_NOMOVE|w32.SWP_NOSIZE|w32.SWP_NOZORDER|w32.SWP_NOACTIVATE|w32.SWP_FRAMECHANGED)
	})
}
