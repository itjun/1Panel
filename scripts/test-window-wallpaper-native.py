#!/usr/bin/env python3
"""验证生产背景实际绘制系统壁纸；仅替换测试进程的读取接口，不修改桌面。"""
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

if platform.system() != "Darwin":
    raise SystemExit("This native test requires macOS.")
root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "internal/windowmaterial/material_darwin.go"
bridge = source.read_text().split("/*", 1)[1].split("*/", 1)[0]
bridge = "\n".join(line for line in bridge.splitlines() if not line.startswith("#cgo"))
harness = r'''
#import <objc/runtime.h>
#import <assert.h>
static NSURL *fixtureURL;
static NSURL *fixtureDesktop(id workspace, SEL selector, NSScreen *screen) { return fixtureURL; }
static NSURL *makeWallpaper(NSString *directory, NSString *name, NSColor *color) {
 NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil pixelsWide:64 pixelsHigh:64 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
 [NSGraphicsContext saveGraphicsState];
 NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
 [color setFill]; NSRectFill(NSMakeRect(0,0,64,64));
 [NSGraphicsContext restoreGraphicsState];
 NSURL *url = [NSURL fileURLWithPath:[directory stringByAppendingPathComponent:name]];
 [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToURL:url atomically:YES];
 return url;
}
static NSColor *paintedPixel(NSView *background) {
 NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil pixelsWide:800 pixelsHigh:600 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
 [NSGraphicsContext saveGraphicsState];
 NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
 // 单独验证底层实际取到的像素，材质模糊与 WebView 合成另外做实机验收。
 [background drawRect:background.bounds];
 [NSGraphicsContext restoreGraphicsState];
 return [[bitmap colorAtX:400 y:300] colorUsingColorSpace:NSColorSpace.deviceRGBColorSpace];
}
int main(int argc, char **argv) {
 @autoreleasepool {
  [NSApplication sharedApplication];
  NSString *directory = [NSString stringWithUTF8String:argv[1]];
  NSURL *red = makeWallpaper(directory, @"red.png", NSColor.redColor);
  NSURL *blue = makeWallpaper(directory, @"blue.png", NSColor.blueColor);
  Method method = class_getInstanceMethod(NSWorkspace.class, @selector(desktopImageURLForScreen:));
  IMP original = method_setImplementation(method, (IMP)fixtureDesktop);
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(100,100,800,600) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  NSView *webPlaceholder = [[NSView alloc] initWithFrame:window.contentView.bounds];
  [window.contentView addSubview:webPlaceholder];
  fixtureURL = red;
  applyMaterial((__bridge void *)window, 1);
  NSView *background = window.contentView.subviews.firstObject;
  NSColor *pixel = paintedPixel(background);
  if (!(pixel.redComponent > 0.9 && pixel.blueComponent < 0.1 && pixel.alphaComponent > 0.9)) {
   NSLog(@"FAIL: wallpaper background did not paint the red desktop source (%@)", pixel);
   return 1;
  }
  fixtureURL = blue;
  [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:3.2]];
  // 定时刷新必须在下一次显式 Apply 之前生效。
  pixel = paintedPixel(background);
  assert(pixel.blueComponent > 0.9 && pixel.redComponent < 0.1);
  applyMaterial((__bridge void *)window, 1);
  assert(background == window.contentView.subviews.firstObject);
  pixel = paintedPixel(background);
  if (!(pixel.blueComponent > 0.9 && pixel.redComponent < 0.1 && pixel.alphaComponent > 0.9)) {
   NSLog(@"FAIL: wallpaper background did not refresh to the blue desktop source (%@)", pixel);
   return 1;
  }
  applyMaterial((__bridge void *)window, 0);
  assert(window.contentView.subviews.count == 1 && window.contentView.subviews.firstObject == webPlaceholder);
  method_setImplementation(method, original);
  NSLog(@"PASS: real background pixels follow red/blue desktop sources, reuse the layer and clear on classic fallback");
 }
 return 0;
}
'''
with tempfile.TemporaryDirectory(prefix="onepanel-wallpaper-test-") as directory:
    directory = Path(directory)
    fixture = directory / "test.m"
    binary = directory / "test"
    fixture.write_text(bridge + "\n" + harness)
    subprocess.run(["xcrun", "clang", "-fobjc-arc", "-mmacosx-version-min=13.0", "-framework", "AppKit", str(fixture), "-o", str(binary)], check=True)
    subprocess.run([str(binary), str(directory)], check=True)
