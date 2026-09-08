//go:build windows

// Package winui 提供 Windows 专属窗口材质。
// 磨砂开关在 Win11 22H2（build 22621）+ 映射为云母（Mica）：
// DWM SystemBackdrop 绘制材质层，WebView2 背景透明后透出。
package winui

import (
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

var procSetClassLongPtrW = syscall.NewLazyDLL("user32.dll").NewProc("SetClassLongPtrW")

// SetWindowMica 运行时开/关窗口云母材质，返回是否成功应用。
// 仅 Win11 22621+ 支持；更早系统返回 false，调用方应保持实色窗口。
// 开启时须已把窗口背景设为透明（WebView2 才能透出云母层）。
func SetWindowMica(win *application.WebviewWindow, on bool) bool {
	if !w32.SupportsBackdropTypes() {
		return false
	}
	hwnd := uintptr(win.NativeWindow())
	backdrop := uint32(application.None)
	if on {
		backdrop = uint32(application.Mica)
		// 清掉类背景刷：不再实色擦除客户区，透明 WebView2 直透 DWM 云母层。
		// 关闭时不清，调用方随后的 SetBackgroundColour(实色) 会重设类刷。
		idx := w32.GCLP_HBRBACKGROUND
		procSetClassLongPtrW.Call(hwnd, uintptr(idx), 0)
	}
	w32.EnableTranslucency(hwnd, backdrop)
	w32.InvalidateRect(w32.HWND(hwnd), nil, true) // 整窗重绘，让材质切换立刻可见
	return true
}
