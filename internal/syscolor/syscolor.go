// Package syscolor 解析 Linux 桌面真实的深浅色偏好。
//
// GTK 应用的 gtk-application-prefer-dark-theme 可能被 ~/.config/gtk-*/settings.ini
// 钉在与桌面不一致的值上（WebKitGTK 的 prefers-color-scheme 跟着它走），所以
// 「跟随系统」不能只看 GTK；这里优先问 xdg-desktop-portal 的
// org.freedesktop.appearance/color-scheme（GNOME / KDE 等都实现），门户不可用时
// 退回 gsettings 逐键查询。
package syscolor

import (
	"context"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	portalBusName = "org.freedesktop.portal.Desktop"
	portalPath    = "/org/freedesktop/portal/desktop"
	portalIface   = "org.freedesktop.portal.Settings"

	appearanceNamespace = "org.freedesktop.appearance"
	colorSchemeKey      = "color-scheme"
)

// 门户 color-scheme：0 无偏好、1 偏好暗色、2 偏好亮色。无偏好按亮色处理
// （与 GTK4 / libadwaita 的默认一致）。
const (
	portalNoPreference uint32 = 0
	portalPreferDark   uint32 = 1
	portalPreferLight  uint32 = 2
)

var (
	// 查询门户与执行 gsettings 的入口，测试里替换。
	portalScheme = func(ctx context.Context) (uint32, bool) { return readPortalScheme(ctx) }
	gsettingsRun = func(ctx context.Context) (string, error) {
		out, err := exec.CommandContext(ctx, "gsettings", "get",
			"org.gnome.desktop.interface", "color-scheme").Output()
		return string(out), err
	}
)

// SystemPrefersDark 返回桌面当前是否偏好暗色；两种来源都查不到时 ok 为 false，
// 由调用方维持现状。
func SystemPrefersDark() (dark bool, ok bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	if scheme, found := portalScheme(ctx); found {
		return scheme == portalPreferDark, true
	}
	out, err := gsettingsRun(ctx)
	if err != nil {
		return false, false
	}
	return ParseColorScheme(strings.TrimSpace(strings.Trim(strings.TrimSpace(string(out)), "'")))
}

// ParseColorScheme 解析 gsettings / 门户侧的 color-scheme 字符串。
func ParseColorScheme(value string) (dark bool, ok bool) {
	switch value {
	case "prefer-dark":
		return true, true
	case "default", "prefer-light", "":
		return false, true
	default:
		return false, false
	}
}

func readPortalScheme(ctx context.Context) (uint32, bool) {
	conn, err := dbus.SessionBus()
	if err != nil {
		return portalNoPreference, false
	}
	var value dbus.Variant
	err = conn.Object(portalBusName, portalPath).
		CallWithContext(ctx, portalIface+".ReadOne", 0, appearanceNamespace, colorSchemeKey).
		Store(&value)
	if err != nil {
		return portalNoPreference, false
	}
	switch scheme := value.Value().(type) {
	case uint32:
		if scheme > portalPreferLight {
			return portalNoPreference, false
		}
		return scheme, true
	case int32:
		if scheme < 0 || scheme > int32(portalPreferLight) {
			return portalNoPreference, false
		}
		return uint32(scheme), true
	default:
		return portalNoPreference, false
	}
}

// ParseSettingChanged 解析门户 SettingChanged 信号体（namespace、key、value），
// 只认 appearance 的 color-scheme 变化。
func ParseSettingChanged(body []any) (dark bool, ok bool) {
	if len(body) < 3 {
		return false, false
	}
	namespace, _ := body[0].(string)
	key, _ := body[1].(string)
	if namespace != appearanceNamespace || key != colorSchemeKey {
		return false, false
	}
	variant, alright := body[2].(dbus.Variant)
	if !alright {
		return false, false
	}
	switch scheme := variant.Value().(type) {
	case uint32:
		return scheme == portalPreferDark, true
	case int32:
		return scheme == int32(portalPreferDark), true
	default:
		return false, false
	}
}

// WatchSystemPrefersDark 订阅门户的深浅色变化并回调。订阅失败（无会话总线 /
// 无门户）时回调不会触发，stop 为空操作。
func WatchSystemPrefersDark(fn func(dark bool)) (stop func()) {
	conn, err := dbus.SessionBus()
	if err != nil {
		return func() {}
	}
	if err := conn.AddMatchSignal(
		dbus.WithMatchObjectPath(dbus.ObjectPath(portalPath)),
		dbus.WithMatchInterface(portalIface),
	); err != nil {
		return func() {}
	}
	signals := make(chan *dbus.Signal, 4)
	conn.Signal(signals)
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-done:
				return
			case signal := <-signals:
				if dark, matched := ParseSettingChanged(signal.Body); matched {
					fn(dark)
				}
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			close(done)
			conn.RemoveSignal(signals)
			_ = conn.RemoveMatchSignal(
				dbus.WithMatchObjectPath(dbus.ObjectPath(portalPath)),
				dbus.WithMatchInterface(portalIface),
			)
		})
	}
}
