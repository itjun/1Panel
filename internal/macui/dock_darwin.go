//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>

// Accessory：进程还在、菜单栏 extra 还在，Dock / Cmd-Tab 不显示。
// 必须可在主线程同步调用（⌘Q 的 applicationShouldTerminate 就在主线程，
// dispatch_sync 回主线程会卡死）。
static void macuiSetDockIconVisible(int visible) {
	void (^block)(void) = ^{
		if (visible) {
			[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
			[NSApp activateIgnoringOtherApps:YES];
		} else {
			[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
		}
	};
	if ([NSThread isMainThread]) {
		block();
		return;
	}
	dispatch_async(dispatch_get_main_queue(), block);
}
*/
import "C"

// SetDockIconVisible 控制 Dock 图标。false 时切到 Accessory（仅菜单栏）。
func SetDockIconVisible(visible bool) {
	v := C.int(0)
	if visible {
		v = 1
	}
	C.macuiSetDockIconVisible(v)
}
