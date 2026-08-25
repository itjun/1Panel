//go:build darwin

package sshd

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Foundation
#import <Foundation/Foundation.h>

void sshdTriggerHostName(void) {
	@autoreleasepool {
		(void)[[NSProcessInfo processInfo] hostName];
	}
}
*/
import "C"

func triggerProcessHostName() {
	C.sshdTriggerHostName()
}
