//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit -framework Foundation -framework WebKit
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

enum { kMacuiFrostedEffectTag = 0x66726F73 }; // 'fros'

// 与 Wails MacLiquidGlassStyle / 系统 NSGlassEffectView.style 对齐
enum {
	kMacuiGlassStyleAuto = 0,
	kMacuiGlassStyleLight = 1,
	kMacuiGlassStyleDark = 2
};

@interface MacuiFrostedHostView : NSView
@end

@implementation MacuiFrostedHostView
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

static BOOL macuiWindowIsDark(NSWindow *window) {
	NSAppearance *ap = window.effectiveAppearance;
	if (ap == nil) {
		ap = NSApp.effectiveAppearance;
	}
	NSAppearanceName matched =
	    [ap bestMatchFromAppearancesWithNames:@[
		    NSAppearanceNameAqua, NSAppearanceNameDarkAqua
	    ]];
	return [matched isEqualToString:NSAppearanceNameDarkAqua];
}

static BOOL macuiGlassSupported(void) {
	if (@available(macOS 26.0, *)) {
		return NSClassFromString(@"NSGlassEffectView") != nil;
	}
	return NO;
}

// 旧系统：语义材质 + FollowsWindowActiveState，聚焦/失焦交给 AppKit。
static void macuiConfigureVisualEffect(NSVisualEffectView *effectView, BOOL dark) {
	if (dark) {
		if (@available(macOS 15.0, *)) {
			effectView.material = NSVisualEffectMaterialHeaderView;
		} else {
			effectView.material = NSVisualEffectMaterialFullScreenUI;
		}
	} else if (@available(macOS 15.0, *)) {
		effectView.material = NSVisualEffectMaterialUnderPageBackground;
	} else {
		effectView.material = NSVisualEffectMaterialHUDWindow;
	}
	effectView.blendingMode = NSVisualEffectBlendingModeBehindWindow;
	// 关键：跟随窗口激活态，失焦由系统收成 inactive 磨砂（非手搓 Active）
	effectView.state = NSVisualEffectStateFollowsWindowActiveState;
	effectView.emphasized = NO;
	// 跟随窗口 appearance（由 SetWindowAppearance 设 Aqua/DarkAqua/nil）
	effectView.appearance = nil;
}

// macOS 26/27：NSGlassEffectView；激活态交给系统；tint 保证可读（非裸透）。
static void macuiConfigureGlassEffect(NSView *glassView, BOOL dark) {
	int style = dark ? kMacuiGlassStyleDark : kMacuiGlassStyleLight;
	if ([glassView respondsToSelector:@selector(setStyle:)]) {
		[glassView setValue:@(style) forKey:@"style"];
	}
	if ([glassView respondsToSelector:@selector(setTintColor:)]) {
		// 系统 tint：亮白 / 暗黑半透明，壁纸只透一点，字必须可读
		NSColor *tint = dark
		                    ? [NSColor colorWithCalibratedWhite:0.08 alpha:0.55]
		                    : [NSColor colorWithCalibratedWhite:1.0 alpha:0.55];
		[glassView performSelector:@selector(setTintColor:) withObject:tint];
	}
	if ([glassView respondsToSelector:@selector(setState:)]) {
		@try {
			// FollowsWindowActiveState = 0：聚焦/失焦跟系统
			[glassView setValue:@(0) forKey:@"state"];
		} @catch (__unused NSException *ex) {
		}
	}
	glassView.appearance = nil;
}

static NSView *macuiMakeInnerEffect(BOOL dark, NSRect frame) {
	if (macuiGlassSupported()) {
		Class glassClass = NSClassFromString(@"NSGlassEffectView");
		NSView *glass = [[glassClass alloc] initWithFrame:frame];
		glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
		macuiConfigureGlassEffect(glass, dark);
		return glass;
	}
	NSVisualEffectView *effect =
	    [[NSVisualEffectView alloc] initWithFrame:frame];
	effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
	macuiConfigureVisualEffect(effect, dark);
	return effect;
}

static void macuiRemoveLegacyTint(NSView *contentView) {
	// 清理旧版手搓黑/白罩（tag 'tint'），避免挡住系统失焦适配
	NSView *legacy = [contentView viewWithTag:0x74696E74];
	if (legacy != nil) {
		[legacy removeFromSuperview];
	}
}

static void macuiConfigureHost(MacuiFrostedHostView *host, NSWindow *window) {
	BOOL dark = macuiWindowIsDark(window);
	NSArray *subs = [host.subviews copy];
	for (NSView *sub in subs) {
		[sub removeFromSuperview];
	}
	NSView *inner = macuiMakeInnerEffect(dark, host.bounds);
	[host addSubview:inner];
	macuiRemoveLegacyTint(window.contentView);
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
	macuiRemoveLegacyTint(contentView);

	if (frosted) {
		[window setOpaque:NO];
		[window setBackgroundColor:[NSColor clearColor]];

		NSView *existing = [contentView viewWithTag:kMacuiFrostedEffectTag];
		MacuiFrostedHostView *host = nil;
		if ([existing isKindOfClass:[MacuiFrostedHostView class]]) {
			host = (MacuiFrostedHostView *)existing;
		} else {
			if (existing != nil) {
				[existing removeFromSuperview];
			}
			host = [[MacuiFrostedHostView alloc] initWithFrame:contentView.bounds];
			host.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
			[contentView addSubview:host positioned:NSWindowBelow relativeTo:nil];
		}
		macuiConfigureHost(host, window);

		if (webView != nil) {
			[webView setValue:@NO forKey:@"drawsBackground"];
			@try {
				[webView setValue:[NSColor clearColor] forKey:@"backgroundColor"];
			} @catch (__unused NSException *ex) {
			}
		}
		return;
	}

	NSView *effect = [contentView viewWithTag:kMacuiFrostedEffectTag];
	if (effect != nil) {
		[effect removeFromSuperview];
	}
	[window setOpaque:YES];
	if (webView != nil) {
		[webView setValue:@YES forKey:@"drawsBackground"];
	}
}

static void macuiRefreshFrostedMaterial(void *windowPtr) {
	NSWindow *window = (__bridge NSWindow *)windowPtr;
	if (window == nil) {
		return;
	}
	NSView *contentView = window.contentView;
	if (contentView == nil) {
		return;
	}
	NSView *existing = [contentView viewWithTag:kMacuiFrostedEffectTag];
	if (![existing isKindOfClass:[MacuiFrostedHostView class]]) {
		return;
	}
	macuiConfigureHost((MacuiFrostedHostView *)existing, window);
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

void macuiRefreshWindowFrosted(void *windowPtr) {
	if (windowPtr == NULL) {
		return;
	}
	void *ptr = windowPtr;
	macuiFrostedRunOnMain(^{
		macuiRefreshFrostedMaterial(ptr);
	});
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// SetWindowFrosted 热切换 macOS 窗口磨砂。
// macOS 26/27：NSGlassEffectView（Light/Dark 跟主题）；激活/失焦由系统 API 自动适配。
// 更低版本：NSVisualEffectView + FollowsWindowActiveState。
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

// RefreshWindowFrosted 主题亮/暗变更后重配 Glass style（仍交给系统管聚焦态）。
func RefreshWindowFrosted(win *application.WebviewWindow) {
	if win == nil {
		return
	}
	ptr := win.NativeWindow()
	if ptr == nil {
		return
	}
	C.macuiRefreshWindowFrosted(ptr)
}
