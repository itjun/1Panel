//go:build linux && cgo && !gtk3 && !android && !server

package main

import (
	"os"
	"strings"
	"testing"
)

func TestLinuxGTKApplicationID(t *testing.T) {
	id := linuxGTKApplicationID()
	if id != "com.itjun.panel" {
		t.Fatalf("application id=%q", id)
	}
	if !gtkApplicationIDValid(id) {
		t.Fatalf("回退 application id %q 不合法", id)
	}
	// Wails beta.14 由 Name "1Panel" 推导出的 id，以及 config.yml 里的 productIdentifier。
	for _, bad := range []string{"org.wails.1panel", "com.itjun.1panel"} {
		if gtkApplicationIDValid(bad) {
			t.Fatalf("%s 应以数字开头被 GTK 拒绝", bad)
		}
	}
}

// GNOME 在 Wayland 按 app_id、在 X11 按 _GTK_APPLICATION_ID 找 <id>.desktop，
// 找不到时任务栏图标和窗口归组都会失效。
func TestLinuxDesktopFileMatchesApplicationID(t *testing.T) {
	path := "build/linux/" + linuxGTKApplicationID() + ".desktop"
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("缺少与 application id 同名的桌面文件：%v", err)
	}
	if !strings.Contains(string(b), "\nStartupWMClass=1Panel\n") {
		t.Fatalf("%s 缺少 StartupWMClass=1Panel（X11 WM_CLASS 兜底）", path)
	}
}
