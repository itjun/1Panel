//go:build darwin

package macui

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>
#include <stdlib.h>
#include <string.h>

static char *applicationPath(const char *bundleID) {
	@autoreleasepool {
		NSString *identifier = [NSString stringWithUTF8String:bundleID];
		NSURL *url = [[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:identifier];
		if (url == nil) return NULL;
		return strdup(url.path.fileSystemRepresentation);
	}
}
*/
import "C"

import "unsafe"

// ApplicationPath 查找已注册的应用，不启动该应用。
func ApplicationPath(bundleID string) string {
	id := C.CString(bundleID)
	defer C.free(unsafe.Pointer(id))
	path := C.applicationPath(id)
	if path == nil {
		return ""
	}
	defer C.free(unsafe.Pointer(path))
	return C.GoString(path)
}
