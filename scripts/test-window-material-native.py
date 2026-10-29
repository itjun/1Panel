#!/usr/bin/env python3
"""Exercise the macOS material bridge in a real NSWindow without showing it."""
from pathlib import Path
import platform
import subprocess
import tempfile

if platform.system() != "Darwin":
    raise SystemExit("This native test requires macOS with Xcode command-line tools.")
root = Path(__file__).resolve().parent.parent
source = (root / "internal/windowmaterial/material_darwin.go").read_text()
bridge = source.split("/*", 1)[1].split("*/", 1)[0]
bridge = "\n".join(line for line in bridge.splitlines() if not line.startswith("#cgo"))
harness = r'''#import <WebKit/WebKit.h>
#import <assert.h>
int main(void) {
 @autoreleasepool {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,800,600) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  WKWebView *web = [[WKWebView alloc] initWithFrame:window.contentView.bounds];
  web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [window.contentView addSubview:web];
  for (int i = 0; i < 50; i++) {
   applyMaterial((__bridge void *)window, 1);
   applyMaterial((__bridge void *)window, 1);
   int count = 0;
   NSVisualEffectView *effect = nil;
   for (NSView *v in window.contentView.subviews) {
    if ([v.identifier isEqualToString:@"1panel-frost"]) { count++; effect = (NSVisualEffectView *)v; }
   }
   assert(count == 1 && effect.material == NSVisualEffectMaterialSidebar);
   assert(effect.blendingMode == NSVisualEffectBlendingModeBehindWindow);
   assert(web.superview == window.contentView);
   [window setContentSize:NSMakeSize(800 + i, 600 + i)];
   assert(NSEqualRects(effect.frame, window.contentView.bounds));
   applyMaterial((__bridge void *)window, 0);
   assert(effect.superview == nil && web.superview == window.contentView);
  }
  NSLog(@"PASS: 50 material switches, idempotent setup, native sidebar material and resizing");
 }
 return 0;
}
'''
with tempfile.TemporaryDirectory(prefix="onepanel-native-theme-") as directory:
    directory = Path(directory)
    fixture = directory / "test.m"
    binary = directory / "test"
    fixture.write_text(bridge + "\n" + harness)
    subprocess.run(["xcrun", "clang", "-fobjc-arc", "-mmacosx-version-min=13.0",
                    "-framework", "AppKit", "-framework", "WebKit", "-framework", "Foundation",
                    str(fixture), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
