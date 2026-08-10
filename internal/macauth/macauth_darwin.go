//go:build darwin

package macauth

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Foundation -framework LocalAuthentication
#include <stdio.h>
#include <string.h>
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

// MacAuthSystemPrompt 调用 macOS 系统认证面板
// LAPolicyDeviceOwnerAuthentication：
//   - 有 Touch ID / 生物识别时优先使用
//   - 否则弹出系统「输入密码」对话框（Apple 系统 UI，非应用内输入框）
// 返回：0 成功；-1 用户取消；-2 失败/不可用
static int MacAuthSystemPrompt(const char *reason, char *errbuf, int errlen) {
    @autoreleasepool {
        if (errbuf && errlen > 0) {
            errbuf[0] = '\0';
        }
        NSString *localizedReason = @"解锁 iPannel";
        if (reason && reason[0] != '\0') {
            localizedReason = [NSString stringWithUTF8String:reason];
        }

        LAContext *context = [[LAContext alloc] init];
        NSError *evalError = nil;
        // 先检查是否可用（设备支持密码或生物识别）
        BOOL can = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&evalError];
        if (!can) {
            if (errbuf && errlen > 0) {
                const char *msg = evalError ? [[evalError localizedDescription] UTF8String] : "系统认证不可用";
                snprintf(errbuf, (size_t)errlen, "%s", msg ? msg : "系统认证不可用");
            }
            return -2;
        }

        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        __block int resultCode = -2;
        __block NSString *errMsg = nil;

        [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
                localizedReason:localizedReason
                          reply:^(BOOL success, NSError * _Nullable error) {
            if (success) {
                resultCode = 0;
            } else if (error) {
                // LAErrorUserCancel / LAErrorAppCancel / LAErrorSystemCancel
                if (error.code == LAErrorUserCancel ||
                    error.code == LAErrorAppCancel ||
                    error.code == LAErrorSystemCancel) {
                    resultCode = -1;
                    errMsg = @"已取消认证";
                } else {
                    resultCode = -2;
                    errMsg = error.localizedDescription ?: @"认证失败";
                }
            } else {
                resultCode = -2;
                errMsg = @"认证失败";
            }
            dispatch_semaphore_signal(sem);
        }];

        // 阻塞直到系统面板关闭（主线程调用时需注意：Wails 绑定通常在后台线程）
        dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

        if (resultCode != 0 && errbuf && errlen > 0 && errMsg) {
            const char *msg = [errMsg UTF8String];
            snprintf(errbuf, (size_t)errlen, "%s", msg ? msg : "认证失败");
        }
        return resultCode;
    }
}
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// AuthenticateWithSystem 弹出 macOS 系统认证（密码 / Touch ID）
// 使用 LocalAuthentication · LAPolicyDeviceOwnerAuthentication
func AuthenticateWithSystem(reason string) error {
	if reason == "" {
		reason = "解锁 iPannel"
	}
	var errbuf [512]C.char
	cr := C.CString(reason)
	defer C.free(unsafe.Pointer(cr))

	code := C.MacAuthSystemPrompt(cr, &errbuf[0], C.int(len(errbuf)))
	msg := C.GoString(&errbuf[0])
	switch code {
	case 0:
		return nil
	case -1:
		if msg == "" {
			return fmt.Errorf("已取消认证")
		}
		return fmt.Errorf("%s", msg)
	default:
		if msg == "" {
			return fmt.Errorf("系统认证失败")
		}
		return fmt.Errorf("%s", msg)
	}
}

// VerifyPassword 保留兼容；系统认证场景请用 AuthenticateWithSystem
func VerifyPassword(username, password string) error {
	_ = username
	_ = password
	return fmt.Errorf("请使用系统认证解锁")
}
