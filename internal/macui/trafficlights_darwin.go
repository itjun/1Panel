//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=10.13
#cgo LDFLAGS: -framework AppKit -framework Foundation
#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static char kMacuiTrafficLightKey;

static void macuiRunOnMain(void (^block)(void)) {
	if (block == nil) {
		return;
	}
	if ([NSThread isMainThread]) {
		block();
		return;
	}
	dispatch_async(dispatch_get_main_queue(), block);
}

@interface MacuiTrafficLightPositioner : NSObject
@property(nonatomic, assign) void *windowPtr;
@property(nonatomic, assign) double titleBarHeight;
- (void)applyNow;
- (void)applyAsync;
- (void)onNote:(NSNotification *)note;
@end

@implementation MacuiTrafficLightPositioner

- (void)applyNow {
	NSWindow *window = (__bridge NSWindow *)self.windowPtr;
	if (window == nil) {
		return;
	}
	NSButton *closeButton = [window standardWindowButton:NSWindowCloseButton];
	NSButton *miniaturizeButton = [window standardWindowButton:NSWindowMiniaturizeButton];
	NSButton *zoomButton = [window standardWindowButton:NSWindowZoomButton];
	if (closeButton == nil || miniaturizeButton == nil || zoomButton == nil) {
		return;
	}

	NSView *titleBarView = closeButton.superview;
	if (titleBarView == nil) {
		return;
	}

	CGFloat customH = (CGFloat)self.titleBarHeight;
	if (customH < 1.0) {
		return;
	}

	// 系统 NSTitlebarContainerView 默认约 28pt，y 会被夹在底部，无法下移到 40pt 通栏中线。
	// 先把容器拉高到通栏高度，再在容器内垂直居中按钮。
	NSView *container = titleBarView.superview;
	if (container != nil) {
		NSView *parent = container.superview;
		if (parent != nil) {
			NSRect cf = container.frame;
			CGFloat parentH = NSHeight(parent.frame);
			if (fabs(cf.size.height - customH) > 0.5 ||
			    fabs(cf.origin.y - (parentH - customH)) > 0.5) {
				cf.size.height = customH;
				cf.origin.y = parentH - customH;
				container.frame = cf;
			}
		}
	}

	{
		NSRect tf = titleBarView.frame;
		if (fabs(tf.size.height - customH) > 0.5 || fabs(tf.origin.y) > 0.5) {
			tf.size.height = customH;
			tf.origin.y = 0;
			tf.origin.x = 0;
			tf.size.width = NSWidth(titleBarView.superview.bounds);
			titleBarView.frame = tf;
		}
	}

	CGFloat viewH = NSHeight(titleBarView.frame);
	if (viewH < 1.0) {
		return;
	}
	CGFloat btnH = NSHeight(closeButton.frame);
	// 与前端通栏 flex 垂直居中同一几何中线（不再额外 optical nudge）
	CGFloat y = (viewH - btnH) * 0.5;
	if (y < 0) {
		y = 0;
	}

	NSArray<NSButton *> *buttons = @[ closeButton, miniaturizeButton, zoomButton ];
	BOOL needMove = NO;
	for (NSButton *btn in buttons) {
		if (fabs(btn.frame.origin.y - y) > 0.5) {
			needMove = YES;
			break;
		}
	}
	if (!needMove) {
		return;
	}

	for (NSButton *btn in buttons) {
		btn.translatesAutoresizingMaskIntoConstraints = YES;
		NSRect frame = btn.frame;
		frame.origin.y = y;
		btn.frame = frame;
	}
}

- (void)applyAsync {
	__weak MacuiTrafficLightPositioner *weakSelf = self;
	macuiRunOnMain(^{
		[weakSelf applyNow];
	});
}

- (void)onNote:(NSNotification *)note {
	(void)note;
	[self applyAsync];
}

@end

static void macuiInstallOnMain(void *windowPtr, double titleBarHeight) {
	NSWindow *window = (__bridge NSWindow *)windowPtr;
	MacuiTrafficLightPositioner *existing =
	    objc_getAssociatedObject(window, &kMacuiTrafficLightKey);
	if (existing != nil) {
		existing.titleBarHeight = titleBarHeight;
		[existing applyNow];
		return;
	}

	MacuiTrafficLightPositioner *p = [MacuiTrafficLightPositioner new];
	p.windowPtr = windowPtr;
	p.titleBarHeight = titleBarHeight;
	objc_setAssociatedObject(window, &kMacuiTrafficLightKey, p, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

	NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
	[nc addObserver:p
	       selector:@selector(onNote:)
	           name:NSWindowDidResizeNotification
	         object:window];
	[nc addObserver:p
	       selector:@selector(onNote:)
	           name:NSWindowDidExitFullScreenNotification
	         object:window];

	NSButton *closeButton = [window standardWindowButton:NSWindowCloseButton];
	if (closeButton != nil) {
		// 系统会在 layout / tracking 更新时把按钮拽回默认位置，需再推一次
		[nc addObserver:p
		       selector:@selector(onNote:)
		           name:NSViewDidUpdateTrackingAreasNotification
		         object:closeButton];
	}

	[p applyNow];
}

void macuiInstallCenteredTrafficLights(void *windowPtr, double titleBarHeight) {
	if (windowPtr == NULL) {
		return;
	}
	double h = titleBarHeight;
	void *ptr = windowPtr;
	macuiRunOnMain(^{
		macuiInstallOnMain(ptr, h);
	});
}

void macuiApplyCenteredTrafficLights(void *windowPtr) {
	if (windowPtr == NULL) {
		return;
	}
	void *ptr = windowPtr;
	macuiRunOnMain(^{
		NSWindow *window = (__bridge NSWindow *)ptr;
		MacuiTrafficLightPositioner *p =
		    objc_getAssociatedObject(window, &kMacuiTrafficLightKey);
		if (p != nil) {
			[p applyNow];
		}
	});
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// InstallCenteredTrafficLights 将 macOS 红绿灯垂直居中到自定义通栏高度内。
// 会拉高系统标题栏容器（默认约 28pt），否则按钮无法下移到 40pt 通栏中线。
// AppKit 几何修改必须在主线程；内部会自动 dispatch 到 main queue。
func InstallCenteredTrafficLights(win *application.WebviewWindow, titleBarHeight int) {
	if win == nil || titleBarHeight <= 0 {
		return
	}
	ptr := win.NativeWindow()
	if ptr == nil {
		return
	}
	C.macuiInstallCenteredTrafficLights(ptr, C.double(titleBarHeight))
}

// ApplyCenteredTrafficLights 立即再应用一次（窗口 Show / Resize 后调用）。
func ApplyCenteredTrafficLights(win *application.WebviewWindow) {
	if win == nil {
		return
	}
	ptr := win.NativeWindow()
	if ptr == nil {
		return
	}
	C.macuiApplyCenteredTrafficLights(ptr)
}
