//go:build darwin

package sysfonts

/*
#cgo CFLAGS: -mmacosx-version-min=13.0
#cgo LDFLAGS: -framework CoreText -framework CoreFoundation
#include <CoreText/CoreText.h>
#include <stdlib.h>

typedef struct {
	char *family;
	int monospace;
} sysfontsEntry;

static char *sysfontsCopyUTF8(CFStringRef text) {
	CFIndex length = CFStringGetLength(text);
	CFIndex size = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
	char *buffer = malloc(size);
	if (buffer == NULL) {
		return NULL;
	}
	if (!CFStringGetCString(text, buffer, size, kCFStringEncodingUTF8)) {
		free(buffer);
		return NULL;
	}
	return buffer;
}

// 等宽：字体自带 kCTFontTraitMonoSpace，或 'i' 与 'M' 步进相等
// （部分中英等宽字体因含全角汉字不设等宽标记，靠步进兜底）。
static int sysfontsIsMonospace(CFStringRef family) {
	CFDictionaryRef attributes = CFDictionaryCreate(
		kCFAllocatorDefault,
		(const void **)&kCTFontFamilyNameAttribute,
		(const void **)&family,
		1,
		&kCFTypeDictionaryKeyCallBacks,
		&kCFTypeDictionaryValueCallBacks);
	if (attributes == NULL) {
		return 0;
	}
	CTFontDescriptorRef descriptor = CTFontDescriptorCreateWithAttributes(attributes);
	CFRelease(attributes);
	if (descriptor == NULL) {
		return 0;
	}
	CTFontRef font = CTFontCreateWithFontDescriptor(descriptor, 12.0, NULL);
	CFRelease(descriptor);
	if (font == NULL) {
		return 0;
	}

	int monospace = 0;
	CTFontSymbolicTraits traits = CTFontGetSymbolicTraits(font);
	if ((traits & kCTFontClassMaskTrait) == kCTFontSymbolicClass) {
		monospace = 0;
	} else if ((traits & kCTFontTraitMonoSpace) != 0) {
		monospace = 1;
	} else {
		UniChar chars[2] = {'i', 'M'};
		CGGlyph glyphs[2] = {0, 0};
		if (CTFontGetGlyphsForCharacters(font, chars, glyphs, 2) && glyphs[0] != 0 && glyphs[1] != 0) {
			CGSize advances[2];
			CTFontGetAdvancesForGlyphs(font, kCTFontOrientationHorizontal, glyphs, advances, 2);
			if (advances[0].width > 0 && advances[0].width == advances[1].width) {
				monospace = 1;
			}
		}
	}
	CFRelease(font);
	return monospace;
}

// 返回条目数；*out 由调用方逐项 free(family) 后再 free(*out)。
static int sysfontsList(sysfontsEntry **out) {
	*out = NULL;
	CFArrayRef families = CTFontManagerCopyAvailableFontFamilyNames();
	if (families == NULL) {
		return -1;
	}
	CFIndex count = CFArrayGetCount(families);
	sysfontsEntry *entries = calloc(count > 0 ? count : 1, sizeof(sysfontsEntry));
	if (entries == NULL) {
		CFRelease(families);
		return -1;
	}
	int filled = 0;
	for (CFIndex i = 0; i < count; i++) {
		CFStringRef family = CFArrayGetValueAtIndex(families, i);
		if (family == NULL || CFStringGetLength(family) == 0) {
			continue;
		}
		if (CFStringHasPrefix(family, CFSTR("."))) {
			continue;
		}
		char *name = sysfontsCopyUTF8(family);
		if (name == NULL) {
			continue;
		}
		entries[filled].family = name;
		entries[filled].monospace = sysfontsIsMonospace(family);
		filled++;
	}
	CFRelease(families);
	*out = entries;
	return filled;
}
*/
import "C"

import (
	"errors"
	"unsafe"
)

func listPlatform() ([]SystemFont, error) {
	var entries *C.sysfontsEntry
	count := int(C.sysfontsList(&entries))
	if count < 0 {
		return nil, errors.New("读取本机字体列表失败")
	}
	defer C.free(unsafe.Pointer(entries))

	items := unsafe.Slice(entries, count)
	fonts := make([]SystemFont, 0, count)
	for _, item := range items {
		fonts = append(fonts, SystemFont{
			Family:    C.GoString(item.family),
			Monospace: item.monospace != 0,
		})
		C.free(unsafe.Pointer(item.family))
	}
	return fonts, nil
}
