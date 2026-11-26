//go:build darwin

package windowmaterial

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>
#include <stdbool.h>

static int reduceTransparency(void) {
    return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
}
static void applyMaterial(void *ptr, bool enabled) {
    NSWindow *window = (__bridge NSWindow *)ptr;
    window.opaque = NO;
    window.backgroundColor = NSColor.clearColor;

    NSView *content = window.contentView;
    NSView *existing = nil;
    for (NSView *view in content.subviews) {
        if ([view.identifier isEqualToString:@"onepanel-window-material"]) {
            existing = view;
            break;
        }
    }
    if (!enabled) {
        [existing removeFromSuperview];
        return;
    }
    if (existing) return;

    // 让 AppKit 合成窗后内容，WebView 用实色覆盖主内容区。
    NSVisualEffectView *sidebar = [[NSVisualEffectView alloc] initWithFrame:content.bounds];
    sidebar.identifier = @"onepanel-window-material";
    sidebar.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    sidebar.material = NSVisualEffectMaterialSidebar;
    sidebar.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    sidebar.state = NSVisualEffectStateFollowsWindowActiveState;
    [content addSubview:sidebar positioned:NSWindowBelow relativeTo:nil];
}
*/
import "C"

import (
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func Automatic() string { return "sidebar" }

func Candidates() []string { return []string{"sidebar"} }

func Capability(material string) (bool, string) {
	if material != "sidebar" {
		return false, "当前系统不支持此窗口材质，正在使用经典外观"
	}
	if !privateMacAPIsEnabled {
		return false, "当前构建不支持半透明窗口，正在使用经典外观"
	}
	if C.reduceTransparency() != 0 {
		return false, "系统已开启降低透明度，正在使用经典外观"
	}
	return true, ""
}

func Apply(win *application.WebviewWindow, material string) error {
	if win == nil {
		return fmt.Errorf("窗口尚未就绪")
	}
	return application.InvokeSyncWithError(func() error {
		window := win.NativeWindow()
		if window == nil {
			return fmt.Errorf("窗口尚未就绪")
		}
		C.applyMaterial(window, C.bool(material == "sidebar"))
		return nil
	})
}

func Observe(changed func()) func() {
	stop := make(chan struct{})
	initial := C.reduceTransparency()
	go func() {
		last := initial
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				next := C.reduceTransparency()
				if next != last {
					last = next
					changed()
				}
			}
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(stop) }) }
}
func ConfigureWindow(options *application.WebviewWindowOptions) {
	options.Mac.Backdrop = application.MacBackdropTransparent
}
func SetAppearance(win *application.WebviewWindow, mode string) {}
