//go:build linux && cgo && !gtk3 && !android && !server

package app

/*
#cgo pkg-config: gtk4

#include <gtk/gtk.h>

// ~/.config/gtk-4.0/settings.ini 可能把 gtk-application-prefer-dark-theme 钉在与
// 桌面不一致的值上，而 WebKitGTK 的 prefers-color-scheme 跟随该属性，「跟随系统」
// 就会被带偏。这里按桌面真实深浅色（门户）纠正。必须在 GTK 主线程调用。
static void panelGTKSetPreferDark(int dark) {
	GtkSettings *settings = gtk_settings_get_default();
	if (settings == NULL) {
		return;
	}
	g_object_set(settings, "gtk-application-prefer-dark-theme", dark ? TRUE : FALSE, NULL);
}
*/
import "C"

import (
	"diteng-pannel/internal/macui"
	"diteng-pannel/internal/syscolor"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// 可注入点：单测替换，避免依赖真实 GTK / dbus。
var (
	watchSystemPrefersDark = syscolor.WatchSystemPrefersDark
	readSystemPrefersDark  = syscolor.SystemPrefersDark
	setGTKPreferDark       = gtkSetPreferDark
)

func gtkSetPreferDark(dark bool) {
	value := 0
	if dark {
		value = 1
	}
	application.InvokeSync(func() { C.panelGTKSetPreferDark(C.int(value)) })
}

// applyNativeAppearance 把颜色模式落到 GTK（窗口底色与 WebKitGTK 的
// prefers-color-scheme 都跟着它走）：light / dark 直接设，auto 以桌面门户的
// 深浅色为准；两种来源都查不到时不改现有值。
func (s *System) applyNativeAppearance(mode macui.AppearanceMode) {
	a := (*App)(s)
	switch mode {
	case macui.AppearanceDark, macui.AppearanceLight:
		a.applyAppearanceValue(mode == macui.AppearanceDark, false)
	case macui.AppearanceAuto:
		if preferDark, ok := readSystemPrefersDark(); ok {
			a.applyAppearanceValue(preferDark, false)
		}
	}
}

// applyAppearanceValue 把确定的深浅色落到 GTK 并记住；notify 为真时通知前端
// 重算主题（WebKitGTK 对 prefers-color-scheme 翻转是否派发 matchMedia change
// 事件随版本而异，前端以本事件为准）。
func (a *App) applyAppearanceValue(dark bool, notify bool) {
	setGTKPreferDark(dark)
	a.themeMu.Lock()
	value := dark
	a.appearanceLastDark = &value
	a.themeMu.Unlock()
	if notify && a.app != nil {
		a.app.Event.Emit("system-appearance-changed", dark)
	}
}

// lastAppearanceDark 返回上次落到 GTK 的深浅色；unknown 为真表示尚未落过值。
func (a *App) lastAppearanceDark() (dark bool, known bool) {
	a.themeMu.Lock()
	defer a.themeMu.Unlock()
	if a.appearanceLastDark == nil {
		return false, false
	}
	return *a.appearanceLastDark, true
}

// startNativeAppearanceWatch 订阅桌面深浅色变化，并在主窗口聚焦时向门户核对：
// 登录早期会话总线 / 门户未就绪会让首次订阅失败（返回 nil），此后每次
// SetThemeAppearance 与窗口聚焦都会重试；门户信号漏发（订阅建立前的变化、
// 门户重启等）由聚焦核对自愈。
func (a *App) startNativeAppearanceWatch() {
	a.appearanceWatchMu.Lock()
	defer a.appearanceWatchMu.Unlock()
	if a.appearanceWatchStopped {
		return
	}
	if a.stopAppearanceWatch == nil {
		if stop := watchSystemPrefersDark(a.onSystemAppearanceChange); stop != nil {
			a.stopAppearanceWatch = stop
		}
	}
	if a.stopAppearanceFocus == nil && a.mainWindow != nil {
		a.stopAppearanceFocus = a.mainWindow.RegisterHook(events.Linux.WindowFocusIn, func(*application.WindowEvent) {
			go a.resyncAppearanceFromPortal()
		})
	}
}

// themeAppearanceMode 加锁读取当前颜色模式（门户回调与聚焦核对共用）。
func (a *App) themeAppearanceMode() macui.AppearanceMode {
	a.themeMu.Lock()
	defer a.themeMu.Unlock()
	return a.themeAppearance
}

// onSystemAppearanceChange 门户深浅色变化回调：跟随系统时同步 GTK 并通知前端。
func (a *App) onSystemAppearanceChange(dark bool) {
	if a.themeAppearanceMode() != macui.AppearanceAuto {
		return
	}
	a.applyAppearanceValue(dark, true)
}

// resyncAppearanceFromPortal 向门户核对当前深浅色，与上次落到 GTK 的值不一致
// 才重设并通知前端；查询失败维持现状。
func (a *App) resyncAppearanceFromPortal() {
	a.startNativeAppearanceWatch()
	if a.themeAppearanceMode() != macui.AppearanceAuto {
		return
	}
	last, known := a.lastAppearanceDark()
	preferDark, ok := readSystemPrefersDark()
	if !ok || (known && last == preferDark) {
		return
	}
	a.applyAppearanceValue(preferDark, true)
}

func (a *App) stopNativeAppearanceWatch() {
	a.appearanceWatchMu.Lock()
	defer a.appearanceWatchMu.Unlock()
	a.appearanceWatchStopped = true
	if a.stopAppearanceWatch != nil {
		a.stopAppearanceWatch()
		a.stopAppearanceWatch = nil
	}
	if a.stopAppearanceFocus != nil {
		a.stopAppearanceFocus()
		a.stopAppearanceFocus = nil
	}
}
