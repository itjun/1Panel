#!/usr/bin/env python3
"""Exercise the production AppKit bridge in a real NSWindow/WKWebView on macOS."""
from pathlib import Path
import platform
import subprocess
import tempfile

if platform.system() != "Darwin":
    raise SystemExit("This native test requires macOS with Xcode command-line tools.")
root = Path(__file__).resolve().parent.parent
source = (root / "internal/macui/vibrancy_darwin.go").read_text()
bridge = source.split("/*", 1)[1].split("*/", 1)[0]
bridge = "\n".join(line for line in bridge.splitlines() if not line.startswith("#cgo"))
harness = r'''#import <assert.h>
int main(void) {
 @autoreleasepool {
  [NSApplication sharedApplication];
  NSWindow *window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,800,600) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  WKWebView *web=[[WKWebView alloc] initWithFrame:window.contentView.bounds];
  web.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
  [window.contentView addSubview:web];
  id original=[web valueForKey:@"drawsBackground"];
  BOOL opaque=window.opaque;
  NSColor *color=window.backgroundColor;
  int capability=panelBackdropCapability();
  assert(capability==0 || capability==2);
  panelObserveTransparency(1);
  int epoch=panelTransparencyVersion();
  [NSWorkspace.sharedWorkspace.notificationCenter postNotificationName:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  assert(panelTransparencyVersion()>epoch);
  NSVisualEffectView *first=nil;
  for(int i=0;i<50;i++) {
   assert(panelSetBackdrop((__bridge void *)window,1)==0);
   PanelBackdrop *backdrop=objc_getAssociatedObject(window,&panelBackdropKey);
   if(!first) first=backdrop.effect;
   assert(first==backdrop.effect);
   int count=0; for(NSView *v in window.contentView.subviews) if([v isKindOfClass:NSVisualEffectView.class]) count++;
   assert(count==1);
   assert(window.opaque==NO);
   assert([[web valueForKey:@"drawsBackground"] boolValue]==NO);
   assert(backdrop.effect.blendingMode==NSVisualEffectBlendingModeBehindWindow);
   assert(backdrop.effect.material==NSVisualEffectMaterialUnderWindowBackground);
   assert(panelSetBackdrop((__bridge void *)window,0)==0);
   assert(first.superview==nil);
   assert(window.opaque==opaque);
   assert([window.backgroundColor isEqual:color]);
   assert([[web valueForKey:@"drawsBackground"] isEqual:original]);
  }
  [window setContentSize:NSMakeSize(1000,700)];
  assert(panelSetBackdrop((__bridge void *)window,1)==0);
  assert(NSEqualRects(first.frame,window.contentView.bounds));
  panelSetBackdrop((__bridge void *)window,0);
  panelObserveTransparency(0);
  assert(panelSetBackdrop(NULL,1)==1);
  NSLog(@"PASS: 50 enable/disable cycles, one reused blur layer, original WKWebView/window state restored, resize and accessibility observer verified");
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
