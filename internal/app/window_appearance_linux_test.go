//go:build linux && cgo && !gtk3 && !android && !server

package app

import (
	"sync"
	"testing"

	"diteng-pannel/internal/macui"
)

// withAppearanceStubs 把 GTK 写入、门户读取与订阅替换为可观察的桩，
// 返回恢复函数；gtkSet 记录每次落到 GTK 的深浅色。
func withAppearanceStubs(t *testing.T) (gtkSet *[]bool, preferDark *stubPreference) {
	t.Helper()
	setCalls := &[]bool{}
	oldSet := setGTKPreferDark
	setGTKPreferDark = func(dark bool) { *setCalls = append(*setCalls, dark) }
	pref := &stubPreference{dark: true, ok: true}
	oldRead := readSystemPrefersDark
	readSystemPrefersDark = func() (bool, bool) { return pref.dark, pref.ok }
	var watchMu sync.Mutex
	watchStarted := false
	oldWatch := watchSystemPrefersDark
	watchSystemPrefersDark = func(func(bool)) func() {
		watchMu.Lock()
		defer watchMu.Unlock()
		if watchStarted {
			return func() {}
		}
		watchStarted = true
		return nil
	}
	t.Cleanup(func() {
		setGTKPreferDark = oldSet
		readSystemPrefersDark = oldRead
		watchSystemPrefersDark = oldWatch
	})
	return setCalls, pref
}

type stubPreference struct {
	dark bool
	ok   bool
}

func lastGTKSet(calls []bool) (dark bool, known bool) {
	if len(calls) == 0 {
		return false, false
	}
	return calls[len(calls)-1], true
}

func setMode(a *App, mode macui.AppearanceMode) {
	a.themeMu.Lock()
	a.themeAppearance = mode
	a.themeMu.Unlock()
}

func TestAppearanceWatchRetriesAfterFailedSubscription(t *testing.T) {
	gtkSet, _ := withAppearanceStubs(t)
	// 共享桩首次订阅失败（返回 nil，模拟登录早期总线未就绪），之后成功。
	a := &App{}
	a.startNativeAppearanceWatch()
	if a.stopAppearanceWatch != nil {
		t.Fatal("订阅失败不应记录 stop（否则永不重试）")
	}
	a.startNativeAppearanceWatch()
	if a.stopAppearanceWatch == nil {
		t.Fatal("订阅恢复后重试应建立监听")
	}
	a.stopNativeAppearanceWatch()
	if a.stopAppearanceWatch != nil {
		t.Fatal("停止后应清空 stop，允许下次启动重建")
	}
	if len(*gtkSet) != 0 {
		t.Fatal("建立监听不应写 GTK")
	}
}

func TestResyncAppearanceHealsStaleGTK(t *testing.T) {
	gtkSet, pref := withAppearanceStubs(t)
	a := &App{}
	setMode(a, macui.AppearanceAuto)

	pref.dark, pref.ok = true, true
	a.resyncAppearanceFromPortal()
	if dark, known := lastGTKSet(*gtkSet); !known || !dark {
		t.Fatalf("门户报深色且从未落值，应写 GTK 为深色：calls=%v", *gtkSet)
	}
	before := len(*gtkSet)
	a.resyncAppearanceFromPortal()
	if len(*gtkSet) != before {
		t.Fatalf("值未变化时重复核对不应再写 GTK：calls=%v", *gtkSet)
	}
	pref.dark = false
	a.resyncAppearanceFromPortal()
	if dark, _ := lastGTKSet(*gtkSet); dark {
		t.Fatalf("门户翻浅色后核对应更新 GTK：calls=%v", *gtkSet)
	}
}

func TestResyncAppearanceKeepsCurrentWhenUnavailable(t *testing.T) {
	gtkSet, pref := withAppearanceStubs(t)
	a := &App{}
	setMode(a, macui.AppearanceAuto)
	a.applyAppearanceValue(true, false)

	pref.ok = false
	before := len(*gtkSet)
	a.resyncAppearanceFromPortal()
	if len(*gtkSet) != before {
		t.Fatal("查询失败应维持现状")
	}
}

func TestAppearanceChangeIgnoredWhenNotAuto(t *testing.T) {
	gtkSet, pref := withAppearanceStubs(t)
	a := &App{}
	setMode(a, macui.AppearanceLight)
	a.applyAppearanceValue(false, false)

	a.onSystemAppearanceChange(true)
	pref.dark = true
	a.resyncAppearanceFromPortal()
	if dark, _ := lastGTKSet(*gtkSet); dark {
		t.Fatalf("非跟随系统模式下门户变化不应改动 GTK：calls=%v", *gtkSet)
	}
}

func TestApplyNativeAppearanceAutoKeepsCurrentWhenUnknown(t *testing.T) {
	gtkSet, pref := withAppearanceStubs(t)
	s := &System{}
	setMode((*App)(s), macui.AppearanceAuto)

	pref.ok = false
	s.applyNativeAppearance(macui.AppearanceAuto)
	if len(*gtkSet) != 0 {
		t.Fatal("auto 查不到深浅色时应维持 GTK 现状")
	}
	pref.dark, pref.ok = true, true
	s.applyNativeAppearance(macui.AppearanceAuto)
	if dark, known := lastGTKSet(*gtkSet); !known || !dark {
		t.Fatalf("auto 查到深色应写 GTK：calls=%v", *gtkSet)
	}
	s.applyNativeAppearance(macui.AppearanceLight)
	if dark, _ := lastGTKSet(*gtkSet); dark {
		t.Fatalf("light 模式应写 GTK 浅色：calls=%v", *gtkSet)
	}
}
