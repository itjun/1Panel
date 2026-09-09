//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit -framework Foundation
#import <AppKit/AppKit.h>
#import <stdatomic.h>

static void macuiAppearanceRunOnMain(void (^block)(void)) {
	if (block == nil) {
		return;
	}
	if ([NSThread isMainThread]) {
		block();
		return;
	}
	dispatch_async(dispatch_get_main_queue(), block);
}

// mode: 0=跟随系统(nil), 1=亮色 Aqua, 2=暗色 DarkAqua
static void macuiApplyWindowAppearance(void *windowPtr, int mode) {
	NSWindow *window = (__bridge NSWindow *)windowPtr;
	if (window == nil) {
		return;
	}
	if (mode == 1) {
		[window setAppearance:[NSAppearance appearanceNamed:NSAppearanceNameAqua]];
	} else if (mode == 2) {
		[window setAppearance:[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]];
	} else {
		[window setAppearance:nil];
	}
}

void macuiSetWindowAppearance(void *windowPtr, int mode) {
	if (windowPtr == NULL) {
		return;
	}
	void *ptr = windowPtr;
	int m = mode;
	macuiAppearanceRunOnMain(^{
		macuiApplyWindowAppearance(ptr, m);
	});
}

static int macuiSystemIsDark(void) {
	NSAppearance *ap = NSApp.effectiveAppearance;
	NSAppearanceName matched =
	    [ap bestMatchFromAppearancesWithNames:@[
		    NSAppearanceNameAqua, NSAppearanceNameDarkAqua
	    ]];
	return [matched isEqualToString:NSAppearanceNameDarkAqua] ? 1 : 0;
}

static id macuiThemeObserver = nil;
static _Atomic int macuiThemeObserverEnabled = 0;
static _Atomic int macuiThemeEpoch = 0;
static _Atomic int macuiThemeDark = 0;

void macuiStartSystemAppearanceObserver(void) {
	atomic_store(&macuiThemeObserverEnabled, 1);
	atomic_store(&macuiThemeDark, macuiSystemIsDark());
	macuiAppearanceRunOnMain(^{
		if (macuiThemeObserver != nil) {
			[[NSDistributedNotificationCenter defaultCenter]
			    removeObserver:macuiThemeObserver];
			macuiThemeObserver = nil;
		}
		macuiThemeObserver = [[NSDistributedNotificationCenter defaultCenter]
		    addObserverForName:@"AppleInterfaceThemeChangedNotification"
		                    object:nil
		                     queue:[NSOperationQueue mainQueue]
		                usingBlock:^(NSNotification *_Nonnull note) {
			              dispatch_after(
			                  dispatch_time(DISPATCH_TIME_NOW, (int64_t)(80 * NSEC_PER_MSEC)),
			                  dispatch_get_main_queue(), ^{
				                if (!atomic_load(&macuiThemeObserverEnabled)) {
					                return;
				                }
				                atomic_store(&macuiThemeDark, macuiSystemIsDark());
				                atomic_fetch_add(&macuiThemeEpoch, 1);
			                  });
		                }];
	});
}

void macuiStopSystemAppearanceObserver(void) {
	atomic_store(&macuiThemeObserverEnabled, 0);
	macuiAppearanceRunOnMain(^{
		if (macuiThemeObserver != nil) {
			[[NSDistributedNotificationCenter defaultCenter]
			    removeObserver:macuiThemeObserver];
			macuiThemeObserver = nil;
		}
	});
}

int macuiQuerySystemDark(void) {
	__block int dark = 0;
	if ([NSThread isMainThread]) {
		dark = macuiSystemIsDark();
	} else {
		dispatch_sync(dispatch_get_main_queue(), ^{
			dark = macuiSystemIsDark();
		});
	}
	return dark;
}

int macuiThemeEpochValue(void) { return atomic_load(&macuiThemeEpoch); }
int macuiThemeDarkValue(void) { return atomic_load(&macuiThemeDark); }
*/
import "C"

import (
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// AppearanceMode 窗口外观模式，与前端 ThemeKey 对齐。
type AppearanceMode string

const (
	AppearanceAuto  AppearanceMode = "auto"
	AppearanceLight AppearanceMode = "light"
	AppearanceDark  AppearanceMode = "dark"
)

var (
	themeCbMu     sync.Mutex
	themeCb       func(dark bool)
	themePollOnce sync.Once
)

// SetWindowAppearance 设置窗口 NSAppearance：auto 跟随系统，light/dark 强制。
// 强制暗色时磨砂才会走系统黑色 vibrancy（即使系统当前是浅色）。
func SetWindowAppearance(win *application.WebviewWindow, mode AppearanceMode) {
	if win == nil {
		return
	}
	ptr := win.NativeWindow()
	if ptr == nil {
		return
	}
	m := 0
	switch mode {
	case AppearanceLight:
		m = 1
	case AppearanceDark:
		m = 2
	default:
		m = 0
	}
	C.macuiSetWindowAppearance(ptr, C.int(m))
}

// StartSystemAppearanceObserver 监听系统外观变化。
// ObjC 写原子 epoch，Go 轮询回调（避免 cgo //export 限制）。
func StartSystemAppearanceObserver(cb func(dark bool)) {
	themeCbMu.Lock()
	themeCb = cb
	themeCbMu.Unlock()
	C.macuiStartSystemAppearanceObserver()

	themePollOnce.Do(func() {
		go func() {
			last := int(C.macuiThemeEpochValue())
			ticker := time.NewTicker(200 * time.Millisecond)
			defer ticker.Stop()
			for range ticker.C {
				cur := int(C.macuiThemeEpochValue())
				if cur == last {
					continue
				}
				last = cur
				dark := C.macuiThemeDarkValue() != 0
				themeCbMu.Lock()
				fn := themeCb
				themeCbMu.Unlock()
				if fn != nil {
					fn(dark)
				}
			}
		}()
	})
}

// StopSystemAppearanceObserver 停止系统外观监听。
func StopSystemAppearanceObserver() {
	C.macuiStopSystemAppearanceObserver()
	themeCbMu.Lock()
	themeCb = nil
	themeCbMu.Unlock()
}

// SystemAppearanceIsDark 查询当前系统是否为暗色外观。
func SystemAppearanceIsDark() bool {
	return C.macuiQuerySystemDark() != 0
}
