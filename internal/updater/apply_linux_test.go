//go:build linux

package updater

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestSupportedAppImageEnv(t *testing.T) {
	t.Setenv("APPIMAGE", "/tmp/1Panel.AppImage")
	supported, reason := Supported()
	if supported {
		t.Fatal("AppImage 形态应禁用自动更新")
	}
	if !strings.Contains(reason, "AppImage") {
		t.Fatalf("禁用原因应说明 AppImage：%q", reason)
	}
}

func TestSupportedWritableDir(t *testing.T) {
	supported, reason := Supported()
	exe, err := currentExe()
	if err != nil {
		t.Skipf("无法定位测试二进制：%v", err)
	}
	if unix.Access(filepath.Dir(exe), unix.W_OK) == nil {
		if !supported || reason != "" {
			t.Fatalf("用户可写目录应支持自动更新：%v %q", supported, reason)
		}
	}
}
