//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>

// 按钮序号与 NSAlert 返回值一致：0=第一钮（右端默认）、1=第二钮、2=第三钮。
// 布局自右向左添加，视觉从左到右为：取消 | 挂到后台 | 退出。
typedef struct {
	int action;   // 0=退出 1=后台 2=取消
	int askAgain; // suppression 勾选：1=下次仍询问
} MacuiQuitConfirmResult;

static MacuiQuitConfirmResult macuiShowQuitConfirm(int askChecked, const char *quitShortcutLabel) {
	__block MacuiQuitConfirmResult out = {.action = 2, .askAgain = askChecked ? 1 : 0};

	void (^block)(void) = ^{
		NSAlert *alert = [[NSAlert alloc] init];
		alert.alertStyle = NSAlertStyleInformational;
		alert.messageText = @"要退出 1Panel 还是挂到后台运行？";
		alert.informativeText = @"挂到后台后，告警与企微仍会送达。";

		// 先加的在右侧：退出（默认）→ 挂到后台 → 取消（Esc）
		NSButton *quitBtn = [alert addButtonWithTitle:@"退出 1Panel"];
		quitBtn.keyEquivalent = @"\r";
		[alert addButtonWithTitle:@"挂到后台运行"];
		NSButton *cancelBtn = [alert addButtonWithTitle:@"取消"];
		cancelBtn.keyEquivalent = @"\033";

		alert.showsSuppressionButton = YES;
		NSString *label = @"按 ⌘Q 退出前先询问";
		if (quitShortcutLabel != NULL && quitShortcutLabel[0] != '\0') {
			label = [NSString stringWithUTF8String:quitShortcutLabel];
		}
		alert.suppressionButton.title = label;
		alert.suppressionButton.state = askChecked ? NSControlStateValueOn : NSControlStateValueOff;

		[NSApp activateIgnoringOtherApps:YES];
		NSModalResponse resp = [alert runModal];
		if (resp == NSAlertFirstButtonReturn) {
			out.action = 0;
		} else if (resp == NSAlertSecondButtonReturn) {
			out.action = 1;
		} else {
			out.action = 2;
		}
		out.askAgain = (alert.suppressionButton.state == NSControlStateValueOn) ? 1 : 0;
	};

	if ([NSThread isMainThread]) {
		block();
	} else {
		dispatch_sync(dispatch_get_main_queue(), block);
	}
	return out;
}
*/
import "C"
import "unsafe"

// QuitConfirmAction 用户在退出确认框中的选择。
type QuitConfirmAction int

const (
	QuitConfirmQuit       QuitConfirmAction = 0
	QuitConfirmBackground QuitConfirmAction = 1
	QuitConfirmCancel     QuitConfirmAction = 2
)

// ShowQuitConfirm 弹出 Firefox 风格确认框（三按钮 + 「退出前询问」勾选）。
// askChecked 为勾选初值；返回最终勾选状态。ok 恒为 true。
// quitShortcutLabel 例如「按 ⌘Q 退出前先询问」；空则用默认文案。
func ShowQuitConfirm(askChecked bool, quitShortcutLabel string) (action QuitConfirmAction, askAgain bool, ok bool) {
	ask := C.int(0)
	if askChecked {
		ask = 1
	}
	var cLabel *C.char
	if quitShortcutLabel != "" {
		cLabel = C.CString(quitShortcutLabel)
		defer C.free(unsafe.Pointer(cLabel))
	}
	r := C.macuiShowQuitConfirm(ask, cLabel)
	return QuitConfirmAction(r.action), r.askAgain != 0, true
}
