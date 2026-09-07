//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit -framework Foundation -framework WebKit
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

enum { kMacuiFrostedEffectTag = 0x66726F73 }; // 'fros'

@interface MacuiFrostedEffectView : NSVisualEffectView
@end

@implementation MacuiFrostedEffectView
- (NSInteger)tag {
	return kMacuiFrostedEffectTag;
}
@end

static void macuiFrostedRunOnMain(void (^block)(void)) {
	if (block == nil) {
		return;
	}
	if ([NSThread isMainThread]) {
		block();
		return;
	}
	dispatch_async(dispatch_get_main_queue(), block);
}

static NSView *macuiFindWebView(NSView *root) {
	if (root == nil) {
		return nil;
	}
	if ([root isKindOfClass:[WKWebView class]]) {
		return root;
	}
	for (NSView *sub in root.subviews) {
		NSView *found = macuiFindWebView(sub);
		if (found != nil) {
			return found;
		}
	}
	return nil;
}

static void macuiApplyWindowFrosted(void *windowPtr, int frosted) {
	NSWindow *window = (__bridge NSWindow *)windowPtr;
	if (window == nil) {
		return;
	}
	NSView *contentView = window.contentView;
	if (contentView == nil) {
		return;
	}
	NSView *webView = macuiFindWebView(contentView);

	if (frosted) {
		[window setOpaque:NO];
		[window setBackgroundColor:[NSColor clearColor]];

		NSView *existing = [contentView viewWithTag:kMacuiFrostedEffectTag];
		if (existing == nil) {
			MacuiFrostedEffectView *effectView =
			    [[MacuiFrostedEffectView alloc] initWithFrame:contentView.bounds];
			effectView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
			effectView.blendingMode = NSVisualEffectBlendingModeBehindWindow;
			effectView.state = NSVisualEffectStateActive;
			[contentView addSubview:effectView positioned:NSWindowBelow relativeTo:nil];
		}

		if (webView != nil) {
			[webView setValue:@NO forKey:@"drawsBackground"];
		}
		return;
	}

	NSView *effect = [contentView viewWithTag:kMacuiFrostedEffectTag];
	if (effect != nil) {
		[effect removeFromSuperview];
	}
	[window setOpaque:YES];
	// 实色 RGB 由调用方 win.SetBackgroundColour 同步（主窗/看板不同）
	if (webView != nil) {
		[webView setValue:@YES forKey:@"drawsBackground"];
	}
}

void macuiSetWindowFrosted(void *windowPtr, int frosted) {
	if (windowPtr == NULL) {
		return;
	}
	void *ptr = windowPtr;
	int on = frosted;
	macuiFrostedRunOnMain(^{
		macuiApplyWindowFrosted(ptr, on);
	});
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// SetWindowFrosted 热切换 macOS 窗口磨砂材质。
// 开启：透明底 + 带 tag 的 NSVisualEffectView + webview 不绘背景；
// 关闭：移除 effect view、不透明实色、webview 绘背景。
// 调用方应同时用 win.SetBackgroundColour 同步 Wails 侧颜色。
func SetWindowFrosted(win *application.WebviewWindow, frosted bool) {
	if win == nil {
		return
	}
	ptr := win.NativeWindow()
	if ptr == nil {
		return
	}
	on := 0
	if frosted {
		on = 1
	}
	C.macuiSetWindowFrosted(ptr, C.int(on))
}
