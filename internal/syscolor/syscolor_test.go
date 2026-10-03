package syscolor

import (
	"context"
	"testing"

	"github.com/godbus/dbus/v5"
)

func withSources(portal func(context.Context) (uint32, bool), gsettings func(context.Context) (string, error)) func() {
	oldPortal, oldGsettings := portalScheme, gsettingsRun
	portalScheme, gsettingsRun = portal, gsettings
	return func() { portalScheme, gsettingsRun = oldPortal, oldGsettings }
}

func TestSystemPrefersDarkPrefersPortal(t *testing.T) {
	defer withSources(
		func(context.Context) (uint32, bool) { return portalPreferDark, true },
		func(context.Context) (string, error) {
			t.Fatal("门户可用时不应再查 gsettings")
			return "", nil
		},
	)()
	dark, ok := SystemPrefersDark()
	if !ok || !dark {
		t.Fatalf("门户报 prefer-dark，应解析为暗色：dark=%v ok=%v", dark, ok)
	}
}

func TestSystemPrefersDarkFallsBackToGSettings(t *testing.T) {
	defer withSources(
		func(context.Context) (uint32, bool) { return portalNoPreference, false },
		func(context.Context) (string, error) { return "'prefer-dark'\n", nil },
	)()
	dark, ok := SystemPrefersDark()
	if !ok || !dark {
		t.Fatalf("gsettings 报 prefer-dark，应解析为暗色：dark=%v ok=%v", dark, ok)
	}
}

func TestSystemPrefersDarkUnknownWhenBothFail(t *testing.T) {
	defer withSources(
		func(context.Context) (uint32, bool) { return portalNoPreference, false },
		func(context.Context) (string, error) { return "", context.DeadlineExceeded },
	)()
	dark, ok := SystemPrefersDark()
	if ok {
		t.Fatalf("两个来源都失败时 ok 应为 false：dark=%v", dark)
	}
}

func TestSystemPrefersDarkRejectsBogusGSettingsValue(t *testing.T) {
	defer withSources(
		func(context.Context) (uint32, bool) { return portalNoPreference, false },
		func(context.Context) (string, error) { return "'neon-pink'\n", nil },
	)()
	if _, ok := SystemPrefersDark(); ok {
		t.Fatal("无法识别的取值应视为解析失败")
	}
}

func TestParseColorScheme(t *testing.T) {
	cases := []struct {
		value string
		dark  bool
		ok    bool
	}{
		{"prefer-dark", true, true},
		{"default", false, true},
		{"prefer-light", false, true},
		{"", false, true},
		{"neon-pink", false, false},
	}
	for _, c := range cases {
		dark, ok := ParseColorScheme(c.value)
		if dark != c.dark || ok != c.ok {
			t.Errorf("ParseColorScheme(%q) = (%v, %v)，期望 (%v, %v)", c.value, dark, ok, c.dark, c.ok)
		}
	}
}

func TestParseSettingChanged(t *testing.T) {
	body := []any{
		"org.freedesktop.appearance",
		"color-scheme",
		dbus.MakeVariant(uint32(portalPreferDark)),
	}
	if dark, ok := ParseSettingChanged(body); !ok || !dark {
		t.Fatalf("appearance color-scheme 变为 prefer-dark 应解析为暗色：dark=%v ok=%v", dark, ok)
	}
	body[2] = dbus.MakeVariant(uint32(portalNoPreference))
	if dark, ok := ParseSettingChanged(body); !ok || dark {
		t.Fatalf("无偏好应解析为亮色：dark=%v ok=%v", dark, ok)
	}
	// 别的命名空间 / 键不触发。
	if _, ok := ParseSettingChanged([]any{"org.gnome.desktop.interface", "color-scheme", dbus.MakeVariant(uint32(1))}); ok {
		t.Fatal("非 appearance 命名空间不应触发")
	}
	if _, ok := ParseSettingChanged([]any{"org.freedesktop.appearance", "accent-color", dbus.MakeVariant(uint32(1))}); ok {
		t.Fatal("非 color-scheme 键不应触发")
	}
	// 长度不足与无法解析的值都按不触发处理。
	if _, ok := ParseSettingChanged(body[:2]); ok {
		t.Fatal("信号体缺 value 不应触发")
	}
	body[2] = dbus.MakeVariant("prefer-dark")
	if _, ok := ParseSettingChanged(body); ok {
		t.Fatal("字符串取值不应触发")
	}
}
