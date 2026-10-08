//go:build darwin && cgo

package localsys

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework AppKit
#import <AppKit/AppKit.h>
#include <stdlib.h>
#include <string.h>

static void *localsys_app_icon_png(const char *path, int size, int *outLen) {
	*outLen = 0;
	@autoreleasepool {
		NSString *p = [NSString stringWithUTF8String:path];
		if (p == nil) return NULL;
		NSImage *img = [[NSWorkspace sharedWorkspace] iconForFile:p];
		if (img == nil) return NULL;
		NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
			initWithBitmapDataPlanes:NULL
			pixelsWide:size
			pixelsHigh:size
			bitsPerSample:8
			samplesPerPixel:4
			hasAlpha:YES
			isPlanar:NO
			colorSpaceName:NSCalibratedRGBColorSpace
			bytesPerRow:0
			bitsPerPixel:0];
		if (rep == nil) return NULL;
		NSGraphicsContext *ctx = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
		if (ctx == nil) return NULL;
		[NSGraphicsContext saveGraphicsState];
		[NSGraphicsContext setCurrentContext:ctx];
		ctx.imageInterpolation = NSImageInterpolationHigh;
		[img drawInRect:NSMakeRect(0, 0, size, size)
			fromRect:NSZeroRect
			operation:NSCompositingOperationCopy
			fraction:1.0];
		[NSGraphicsContext restoreGraphicsState];
		NSData *data = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
		if (data == nil || data.length == 0) return NULL;
		void *buf = malloc(data.length);
		if (buf == NULL) return NULL;
		memcpy(buf, data.bytes, data.length);
		*outLen = (int)data.length;
		return buf;
	}
}

static NSString *localsys_pick_name(NSDictionary *d) {
	if (![d isKindOfClass:[NSDictionary class]]) return nil;
	for (NSString *key in @[@"CFBundleDisplayName", @"CFBundleName"]) {
		id v = d[key];
		if ([v isKindOfClass:[NSString class]] && [v length] > 0) return v;
	}
	return nil;
}

static NSString *localsys_lang_code(NSString *ident) {
	return [NSLocale componentsFromLocaleIdentifier:ident][NSLocaleLanguageCode];
}

// 按系统首选语言读目标包的本地化名；不用 displayNameAtPath，它按本进程的本地化取，本程序无中文本地化会回退英文。
// 与访达一致：目标包没有同语种本地化时返回 NULL，由调用方用文件名。
// 返回 malloc 的 UTF-8 字符串，调用方 free。
static char *localsys_app_display_name(const char *path) {
	@autoreleasepool {
		NSString *p = [NSString stringWithUTF8String:path];
		if (p == nil) return NULL;
		NSArray *prefs = [NSLocale preferredLanguages];
		if (prefs.count == 0) return NULL;
		NSString *lang = localsys_lang_code(prefs[0]);
		NSBundle *b = [NSBundle bundleWithPath:p];
		if (b == nil || lang == nil) return NULL;
		NSString *name = nil;
		NSArray *locs = [NSBundle preferredLocalizationsFromArray:b.localizations forPreferences:prefs];
		NSString *loctable = [b pathForResource:@"InfoPlist" ofType:@"loctable"];
		NSDictionary *table = loctable ? [NSDictionary dictionaryWithContentsOfFile:loctable] : nil;
		for (NSString *loc in locs) {
			if (![localsys_lang_code(loc) isEqualToString:lang]) continue;
			name = localsys_pick_name(table[loc]);
			if (name != nil) break;
			NSString *strings = [b pathForResource:@"InfoPlist" ofType:@"strings" inDirectory:nil forLocalization:loc];
			if (strings != nil) name = localsys_pick_name([NSDictionary dictionaryWithContentsOfFile:strings]);
			if (name != nil) break;
		}
		if (name == nil || name.length == 0) return NULL;
		return strdup(name.UTF8String);
	}
}
*/
import "C"

import (
	"os"
	"strings"
	"unsafe"
)

// appIconPNG 用 NSWorkspace 取 .app 图标（含仅有 Assets.car 的新式图标），渲染为 size×size PNG。
func appIconPNG(path string, size int) []byte {
	if !strings.HasSuffix(path, ".app") {
		return nil
	}
	if st, err := os.Stat(path); err != nil || !st.IsDir() {
		return nil
	}
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	var n C.int
	buf := C.localsys_app_icon_png(cpath, C.int(size), &n)
	if buf == nil || n <= 0 {
		return nil
	}
	defer C.free(buf)
	return C.GoBytes(buf, n)
}

// appDisplayName 访达显示名（按系统语言本地化，如 WeChat → 微信），去掉 .app 后缀。
func appDisplayName(path string) string {
	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	cname := C.localsys_app_display_name(cpath)
	if cname == nil {
		return ""
	}
	defer C.free(unsafe.Pointer(cname))
	return strings.TrimSuffix(C.GoString(cname), ".app")
}
