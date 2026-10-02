//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit -framework WebKit -framework Foundation
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import <stdatomic.h>

static char panelBackdropKey;
static _Atomic int panelTransparencyEpoch = 0;
static id panelTransparencyObserver;

@interface PanelBackdrop : NSObject
@property(nonatomic, strong) NSVisualEffectView *effect;
@property(nonatomic, strong) NSColor *originalColor;
@property(nonatomic) BOOL originalOpaque;
@property(nonatomic, strong) id originalDrawsBackground;
@end
@implementation PanelBackdrop
@end

static void panelBackdropOnMain(void (^block)(void)) {
    if ([NSThread isMainThread]) block();
    else dispatch_sync(dispatch_get_main_queue(), block);
}

static WKWebView *panelFindWebView(NSView *view) {
    if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
    for (NSView *child in view.subviews) {
        WKWebView *found = panelFindWebView(child);
        if (found) return found;
    }
    return nil;
}

// 0: available, 1: unsupported OS, 2: accessibility setting.
static int panelBackdropCapability(void) {
    __block int result = 0;
    panelBackdropOnMain(^{
        if (![NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){13,0,0}]) result = 1;
        else if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency) result = 2;
    });
    return result;
}

// Never propagate an Objective-C KVC exception across cgo.
static int panelSetBackdrop(void *ptr, int enabled) {
    if (!ptr) return 1;
    __block int result = 0;
    panelBackdropOnMain(^{
        NSWindow *window = (__bridge NSWindow *)ptr;
        WKWebView *webView = panelFindWebView(window.contentView);
        if (!webView) { result = 1; return; }
        PanelBackdrop *backdrop = objc_getAssociatedObject(window, &panelBackdropKey);
        @try {
            if (enabled) {
                if (!backdrop) {
                    backdrop = [PanelBackdrop new];
                    backdrop.originalColor = window.backgroundColor;
                    backdrop.originalOpaque = window.opaque;
                    backdrop.originalDrawsBackground = [webView valueForKey:@"drawsBackground"];
                    backdrop.effect = [[NSVisualEffectView alloc] initWithFrame:window.contentView.bounds];
                    backdrop.effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
                    backdrop.effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
                    backdrop.effect.material = NSVisualEffectMaterialUnderWindowBackground;
                    backdrop.effect.state = NSVisualEffectStateActive;
                    objc_setAssociatedObject(window, &panelBackdropKey, backdrop, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                }
                // Same internal property used by pinned Wails beta.14.
                [webView setValue:@NO forKey:@"drawsBackground"];
                window.opaque = NO;
                window.backgroundColor = NSColor.clearColor;
                backdrop.effect.frame = window.contentView.bounds;
                if (!backdrop.effect.superview) [window.contentView addSubview:backdrop.effect positioned:NSWindowBelow relativeTo:nil];
            } else if (backdrop) {
                [backdrop.effect removeFromSuperview];
                window.backgroundColor = backdrop.originalColor;
                window.opaque = backdrop.originalOpaque;
                [webView setValue:backdrop.originalDrawsBackground ?: @YES forKey:@"drawsBackground"];
            }
        } @catch (NSException *exception) {
            [backdrop.effect removeFromSuperview];
            window.backgroundColor = backdrop.originalColor ?: NSColor.windowBackgroundColor;
            window.opaque = YES;
            @try { [webView setValue:@YES forKey:@"drawsBackground"]; } @catch (NSException *ignored) {}
            result = 2;
        }
    });
    return result;
}

static void panelObserveTransparency(int enabled) {
    panelBackdropOnMain(^{
        if (panelTransparencyObserver) {
            [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:panelTransparencyObserver];
            panelTransparencyObserver = nil;
        }
        if (enabled) {
            panelTransparencyObserver = [NSWorkspace.sharedWorkspace.notificationCenter
                addObserverForName:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification
                object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
                    atomic_fetch_add(&panelTransparencyEpoch, 1);
                }];
        }
    });
}
static int panelTransparencyVersion(void) { return atomic_load(&panelTransparencyEpoch); }
*/
import "C"

import (
	"fmt"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func FrostedBackdropCapability() (bool, string) {
	switch C.panelBackdropCapability() {
	case 1:
		return false, "当前 macOS 版本不支持亚克力"
	case 2:
		return false, "系统已开启减少透明度，正在使用经典外观"
	default:
		return true, ""
	}
}

func SetFrostedBackdrop(win *application.WebviewWindow, enabled bool) error {
	if win == nil || win.NativeWindow() == nil {
		return fmt.Errorf("窗口尚未就绪")
	}
	flag := C.int(0)
	if enabled {
		flag = 1
	}
	switch C.panelSetBackdrop(win.NativeWindow(), flag) {
	case 1:
		return fmt.Errorf("窗口尚未就绪")
	case 2:
		return fmt.Errorf("系统无法启用原生亚克力，正在使用经典外观")
	}
	return nil
}

// Poll an epoch instead of calling Go while AppKit is holding the UI thread.
func ObserveTransparency(changed func()) func() {
	C.panelObserveTransparency(1)
	stop := make(chan struct{})
	go func() {
		last := C.panelTransparencyVersion()
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				current := C.panelTransparencyVersion()
				if current != last {
					last = current
					changed()
				}
			}
		}
	}()
	return func() { close(stop); C.panelObserveTransparency(0) }
}
