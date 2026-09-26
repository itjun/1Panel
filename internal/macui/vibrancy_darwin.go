//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit -framework Foundation -framework WebKit
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static void macuiEnableFrostedNow(void *windowPtr) {
	NSWindow *window = (__bridge NSWindow *)windowPtr;
	if (window == nil) {
		return;
	}
	// 不透明窗口不会把桌面交给 BehindWindow 材质，磨砂只会是一块白。
	[window setOpaque:NO];
	[window setBackgroundColor:[NSColor clearColor]];
	[window setTitlebarAppearsTransparent:YES];

	// WebView 默认还铺着实色，会把系统磨砂盖住。
	WKWebView *webView = nil;
	if ([window respondsToSelector:@selector(webView)]) {
		webView = [window valueForKey:@"webView"];
		if (webView != nil) {
			[webView setValue:@NO forKey:@"drawsBackground"];
			[webView setValue:[NSColor clearColor] forKey:@"backgroundColor"];
			if (webView.layer != nil) {
				webView.layer.backgroundColor = NSColor.clearColor.CGColor;
				webView.layer.opaque = NO;
			}
		}
	}

	NSVisualEffectView *effect = nil;
	for (NSView *sub in window.contentView.subviews) {
		if ([sub isKindOfClass:[NSVisualEffectView class]]) {
			effect = (NSVisualEffectView *)sub;
			break;
		}
	}
	if (effect == nil) {
		effect = [[NSVisualEffectView alloc] initWithFrame:window.contentView.bounds];
		effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
		[window.contentView addSubview:effect positioned:NSWindowBelow relativeTo:nil];
	}
	effect.material = NSVisualEffectMaterialUnderWindowBackground;
	effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
	effect.state = NSVisualEffectStateActive;
}

static void macuiEnableFrostedOnMain(void *windowPtr) {
	if ([NSThread isMainThread]) {
		macuiEnableFrostedNow(windowPtr);
		return;
	}
	dispatch_async(dispatch_get_main_queue(), ^{
		macuiEnableFrostedNow(windowPtr);
	});
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// EnableFrostedBackdrop 让主窗口能透出桌面，侧栏和顶栏的透明区域才会显出磨砂。
func EnableFrostedBackdrop(win *application.WebviewWindow) {
	if win == nil {
		return
	}
	ptr := win.NativeWindow()
	if ptr == nil {
		return
	}
	C.macuiEnableFrostedOnMain(ptr)
}
