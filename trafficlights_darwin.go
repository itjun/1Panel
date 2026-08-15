//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit
#import <Cocoa/Cocoa.h>

// hideTrafficLights 隐藏/显示当前窗口的红绿灯（关闭/最小化/缩放）按钮。
// Wails 绑定在非主线程调用，Cocoa UI 操作必须派发到主队列，否则崩溃。
static void hideTrafficLights(BOOL hide) {
	dispatch_async(dispatch_get_main_queue(), ^{
		NSApplication *app = [NSApplication sharedApplication];
		NSWindow *w = app.keyWindow ? app.keyWindow : app.mainWindow;
		if (!w) return;
		NSArray *buttons = @[
			[w standardWindowButton:NSWindowCloseButton],
			[w standardWindowButton:NSWindowMiniaturizeButton],
			[w standardWindowButton:NSWindowZoomButton],
		];
		for (NSButton *b in buttons) [b setHidden:hide];
	});
}
*/
import "C"

func setTrafficLightsHidden(hidden bool) {
	C.hideTrafficLights(C.bool(hidden))
}
