//go:build linux && cgo && !gtk3 && !android && !server

package main

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
	dark := false
	switch mode {
	case macui.AppearanceDark:
		dark = true
	case macui.AppearanceAuto:
		preferDark, ok := syscolor.SystemPrefersDark()
		if !ok {
			return
		}
		dark = preferDark
	case macui.AppearanceLight:
	}
	gtkSetPreferDark(dark)
}

// startNativeAppearanceWatch 订阅桌面深浅色变化：跟随系统时同步 GTK 并通知前端。
// WebKitGTK 不会为 prefers-color-scheme 的翻转派发 matchMedia change 事件，
// 前端依赖这里的 system-appearance-changed 事件重算。
func (a *App) startNativeAppearanceWatch() {
	a.appearanceWatchMu.Lock()
	defer a.appearanceWatchMu.Unlock()
	if a.appearanceWatchStopped || a.stopAppearanceWatch != nil {
		return
	}
	a.stopAppearanceWatch = syscolor.WatchSystemPrefersDark(func(dark bool) {
		a.themeMu.Lock()
		mode := a.themeAppearance
		a.themeMu.Unlock()
		if mode != macui.AppearanceAuto {
			return
		}
		gtkSetPreferDark(dark)
		if a.app != nil {
			a.app.Event.Emit("system-appearance-changed", dark)
		}
	})
}

func (a *App) stopNativeAppearanceWatch() {
	a.appearanceWatchMu.Lock()
	defer a.appearanceWatchMu.Unlock()
	a.appearanceWatchStopped = true
	if a.stopAppearanceWatch != nil {
		a.stopAppearanceWatch()
		a.stopAppearanceWatch = nil
	}
}
