//go:build darwin

package windowmaterial

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>

static int reduceTransparency(void) {
    return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
}
// 将系统壁纸放进窗口自身的底层，再由 AppKit 模糊；不采样其他应用。
@interface PanelWallpaperView : NSView
@property(nonatomic, strong) NSImage *wallpaper;
@property(nonatomic, strong) NSURL *wallpaperURL;
@property(nonatomic, strong) NSDate *wallpaperModified;
@property(nonatomic, copy) NSDictionary *wallpaperOptions;
@property(nonatomic, strong) NSTimer *refreshTimer;
- (BOOL)refreshWallpaper;
@end

static NSRect wallpaperRect(NSSize image, NSRect screen, NSDictionary *options) {
    NSSize size = image;
    NSImageScaling scaling = options[NSWorkspaceDesktopImageScalingKey]
        ? [options[NSWorkspaceDesktopImageScalingKey] integerValue] : NSImageScaleProportionallyUpOrDown;
    BOOL isClipped = options[NSWorkspaceDesktopImageAllowClippingKey]
        ? [options[NSWorkspaceDesktopImageAllowClippingKey] boolValue] : YES;
    if (scaling == NSImageScaleAxesIndependently) {
        size = screen.size;
    } else if (scaling != NSImageScaleNone && image.width > 0 && image.height > 0) {
        CGFloat x = screen.size.width / image.width;
        CGFloat y = screen.size.height / image.height;
        CGFloat scale = isClipped ? MAX(x, y) : MIN(x, y);
        if (scaling == NSImageScaleProportionallyDown) scale = MIN(1, scale);
        size = NSMakeSize(image.width * scale, image.height * scale);
    }
    return NSMakeRect(NSMidX(screen) - size.width / 2, NSMidY(screen) - size.height / 2, size.width, size.height);
}

@implementation PanelWallpaperView
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)refreshWallpaper {
    NSScreen *screen = self.window.screen ?: NSScreen.mainScreen;
    NSURL *url = [NSWorkspace.sharedWorkspace desktopImageURLForScreen:screen];
    NSDictionary *options = [NSWorkspace.sharedWorkspace desktopImageOptionsForScreen:screen] ?: @{};
    NSDate *modified = nil;
    [url getResourceValue:&modified forKey:NSURLContentModificationDateKey error:nil];
    if (!self.wallpaper || ![url isEqual:self.wallpaperURL] || ![modified isEqual:self.wallpaperModified]) {
        NSImage *image = url ? [[NSImage alloc] initWithContentsOfURL:url] : nil;
        if (!image || image.size.width <= 0 || image.size.height <= 0) return NO;
        self.wallpaper = image;
        self.wallpaperURL = url;
        self.wallpaperModified = modified;
    }
    self.wallpaperOptions = options;
    self.needsDisplay = YES;
    return YES;
}
- (void)windowGeometryChanged:(NSNotification *)notification {
    if (notification.object != self.window) return;
    if ([notification.name isEqualToString:NSWindowDidChangeScreenNotification]) {
        [self refreshWallpaper];
    } else {
        // 拖动和缩放只重画缓存，避免每一帧都读取壁纸配置和文件属性。
        self.needsDisplay = YES;
    }
}
- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    [NSNotificationCenter.defaultCenter removeObserver:self];
    [self.refreshTimer invalidate];
    self.refreshTimer = nil;
    if (!self.window) return;
    for (NSNotificationName name in @[NSWindowDidMoveNotification, NSWindowDidResizeNotification, NSWindowDidChangeScreenNotification]) {
        [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(windowGeometryChanged:) name:name object:self.window];
    }
    [self refreshWallpaper];
    __weak PanelWallpaperView *weakSelf = self;
    self.refreshTimer = [NSTimer scheduledTimerWithTimeInterval:3 repeats:YES block:^(NSTimer *timer) {
        [weakSelf refreshWallpaper];
    }];
}
- (void)dealloc {
    [self.refreshTimer invalidate];
    [NSNotificationCenter.defaultCenter removeObserver:self];
}
- (void)drawRect:(NSRect)dirtyRect {
    NSColor *fill = self.wallpaperOptions[NSWorkspaceDesktopImageFillColorKey] ?: NSColor.blackColor;
    [fill setFill];
    NSRectFill(self.bounds);
    if (!self.wallpaper) return;
    NSScreen *screen = self.window.screen ?: NSScreen.mainScreen;
    NSRect target = wallpaperRect(self.wallpaper.size, screen.frame, self.wallpaperOptions);
    NSRect location = [self.window convertRectToScreen:[self convertRect:self.bounds toView:nil]];
    target.origin.x -= location.origin.x;
    target.origin.y -= location.origin.y;
    [self.wallpaper drawInRect:target fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1 respectFlipped:YES hints:nil];
}
@end

static int applyMaterial(void *ptr, int material) {
    NSWindow *window = (__bridge NSWindow *)ptr;
    window.opaque = NO;
    window.backgroundColor = NSColor.clearColor;
    NSView *content = window.contentView;
    PanelWallpaperView *existing = nil;
    for (NSView *view in content.subviews) {
        if ([view.identifier isEqualToString:@"onepanel-window-material"]) existing = (PanelWallpaperView *)view;
    }
    if (material && existing) return [existing refreshWallpaper];
    [existing removeFromSuperview];
    if (!material) return 1;
    PanelWallpaperView *wallpaper = [[PanelWallpaperView alloc] initWithFrame:content.bounds];
    wallpaper.identifier = @"onepanel-window-material";
    wallpaper.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [content addSubview:wallpaper positioned:NSWindowBelow relativeTo:nil];
    if (![wallpaper refreshWallpaper]) {
        [wallpaper removeFromSuperview];
        return 0;
    }
    NSVisualEffectView *frost = [[NSVisualEffectView alloc] initWithFrame:wallpaper.bounds];
    frost.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    frost.material = NSVisualEffectMaterialSidebar;
    frost.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    frost.state = NSVisualEffectStateActive;
    [wallpaper addSubview:frost];
    return 1;
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
	if win == nil || win.NativeWindow() == nil {
		return fmt.Errorf("窗口尚未就绪")
	}
	kind := C.int(0)
	if material == "sidebar" {
		kind = 1
	}
	return application.InvokeSyncWithError(func() error {
		if C.applyMaterial(win.NativeWindow(), kind) == 0 {
			return fmt.Errorf("无法读取当前屏幕壁纸，正在使用经典外观")
		}
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
