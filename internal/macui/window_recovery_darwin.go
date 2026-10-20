//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit -framework Foundation
#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static NSRect macuiRecoveredWindowFrame(NSRect frame, NSArray<NSValue *> *visibleFrames,
                                      NSRect primaryVisibleFrame) {
	for (NSValue *value in visibleFrames) {
		if (NSContainsRect(value.rectValue, frame)) {
			return frame;
		}
	}
	if (NSWidth(primaryVisibleFrame) <= 0 || NSHeight(primaryVisibleFrame) <= 0) {
		return frame;
	}
	// 只平移，不改变用户尺寸。大于主屏的窗口保留尺寸，并让左上角可操作。
	frame.origin.x = MAX(NSMinX(primaryVisibleFrame),
	                     MIN(frame.origin.x, NSMaxX(primaryVisibleFrame) - NSWidth(frame)));
	frame.origin.y = MIN(NSMaxY(primaryVisibleFrame) - NSHeight(frame),
	                     MAX(frame.origin.y, NSMinY(primaryVisibleFrame)));
	return frame;
}

static NSSet<NSNumber *> *macuiDisplayIDs(NSArray<NSScreen *> *screens) {
	NSMutableSet<NSNumber *> *ids = [NSMutableSet set];
	for (NSScreen *screen in screens) {
		NSNumber *displayID = screen.deviceDescription[@"NSScreenNumber"];
		if (displayID != nil) {
			[ids addObject:displayID];
		}
	}
	return ids;
}

@interface MacuiDisplayRecovery : NSObject
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic, copy) NSSet<NSNumber *> *displayIDs;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) BOOL recovering;
- (void)recoverNow;
- (void)screenParametersChanged:(NSNotification *)note;
- (void)windowMoved:(NSNotification *)note;
@end

@implementation MacuiDisplayRecovery
- (void)recoverNow {
	NSWindow *window = self.window;
	if (window == nil || (window.styleMask & NSWindowStyleMaskFullScreen) != 0) {
		return;
	}
	NSArray<NSScreen *> *screens = NSScreen.screens;
	if (screens.count == 0) {
		return;
	}
	NSMutableArray<NSValue *> *visibleFrames = [NSMutableArray array];
	for (NSScreen *screen in screens) {
		[visibleFrames addObject:[NSValue valueWithRect:screen.visibleFrame]];
	}
	// screens[0] 才是主屏；mainScreen 会随当前活动窗口切换到外接屏。
	NSRect recovered = macuiRecoveredWindowFrame(window.frame, visibleFrames,
	                                            screens.firstObject.visibleFrame);
	if (!NSEqualPoints(recovered.origin, window.frame.origin)) {
		[window setFrameOrigin:recovered.origin];
	}
}

- (void)screenParametersChanged:(NSNotification *)note {
	(void)note;
	NSSet<NSNumber *> *current = macuiDisplayIDs(NSScreen.screens);
	NSMutableSet<NSNumber *> *removed = [self.displayIDs mutableCopy];
	[removed minusSet:current];
	self.displayIDs = current;
	if (removed.count == 0) {
		return;
	}
	self.recovering = YES;
	NSUInteger generation = ++self.generation;
	[self recoverNow];
	// AppKit 的自动回迁与屏幕通知可能分轮发生；同步校正后，在主队列复核。
	__weak MacuiDisplayRecovery *weakSelf = self;
	dispatch_async(dispatch_get_main_queue(), ^{
		MacuiDisplayRecovery *observer = weakSelf;
		if (observer.generation == generation) {
			[observer recoverNow];
		}
	});
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC),
	               dispatch_get_main_queue(), ^{
		MacuiDisplayRecovery *observer = weakSelf;
		if (observer.generation == generation) {
			[observer recoverNow];
			observer.recovering = NO;
		}
	});
}

- (void)windowMoved:(NSNotification *)note {
	(void)note;
	if (self.recovering) {
		[self recoverNow];
	}
}

- (void)dealloc {
	[[NSNotificationCenter defaultCenter] removeObserver:self];
}
@end

static char kMacuiDisplayRecoveryKey;

static void macuiInstallDisplayRecovery(void *windowPtr) {
	NSWindow *window = (__bridge NSWindow *)windowPtr;
	void (^install)(void) = ^{
		if (objc_getAssociatedObject(window, &kMacuiDisplayRecoveryKey) != nil) {
			return;
		}
		MacuiDisplayRecovery *observer = [MacuiDisplayRecovery new];
		observer.window = window;
		observer.displayIDs = macuiDisplayIDs(NSScreen.screens);
		objc_setAssociatedObject(window, &kMacuiDisplayRecoveryKey, observer,
		                         OBJC_ASSOCIATION_RETAIN_NONATOMIC);
		NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
		[center addObserver:observer selector:@selector(screenParametersChanged:)
		              name:NSApplicationDidChangeScreenParametersNotification object:nil];
		[center addObserver:observer selector:@selector(windowMoved:)
		              name:NSWindowDidMoveNotification object:window];
	};
	if (NSThread.isMainThread) {
		install();
	} else {
		dispatch_async(dispatch_get_main_queue(), install);
	}
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// InstallDisplayRecovery 在显示器移除后恢复窗口的完整可见性，不调整尺寸和外观。
func InstallDisplayRecovery(win *application.WebviewWindow) {
	if win == nil {
		return
	}
	if ptr := win.NativeWindow(); ptr != nil {
		C.macuiInstallDisplayRecovery(ptr)
	}
}
