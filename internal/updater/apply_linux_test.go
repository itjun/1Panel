//go:build linux

package updater

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

// stubBinDir 生成含可执行桩脚本的目录，测试把它注入 PATH 覆盖形态探测分支。
func stubBinDir(t *testing.T, scripts map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range scripts {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

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

// deb 安装且有 pkexec：放行自动更新（pkexec 提权安装新 .deb）。
func TestSupportedDebInstallWithPkexec(t *testing.T) {
	dir := stubBinDir(t, map[string]string{
		"dpkg-query": `echo "1panel: /usr/local/bin/1Panel"`,
		"pkexec":     `exit 0`,
	})
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	supported, reason := Supported()
	if !supported || reason != "" {
		t.Fatalf("deb 安装且有 pkexec 应支持自动更新：%v %q", supported, reason)
	}
}

// deb 安装但系统没有 pkexec：禁用并提示装 polkit 或手动更新。
func TestSupportedDebInstallWithoutPkexec(t *testing.T) {
	dir := stubBinDir(t, map[string]string{
		"dpkg-query": `echo "1panel: /usr/local/bin/1Panel"`,
	})
	// PATH 只留桩目录，确保 LookPath 找不到真实 pkexec
	t.Setenv("PATH", dir)
	supported, reason := Supported()
	if supported {
		t.Fatal("缺 pkexec 的 deb 安装应禁用自动更新")
	}
	if !strings.Contains(reason, "pkexec") {
		t.Fatalf("禁用原因应说明缺 pkexec：%q", reason)
	}
}

// 资产键按安装形态切换：deb 安装取 -deb 后缀（.deb 安装包），其余无后缀。
func TestUpdateAssetKeyDebSuffix(t *testing.T) {
	if CurrentPlatformKey() == "" {
		t.Skip("当前平台无平台键")
	}
	if got := UpdateAssetKey(); got != CurrentPlatformKey() {
		t.Fatalf("非 deb 安装不应有资产键后缀：%q", got)
	}
	dir := stubBinDir(t, map[string]string{
		"dpkg-query": `echo "1panel: /usr/local/bin/1Panel"`,
	})
	t.Setenv("PATH", dir)
	if got := UpdateAssetKey(); got != CurrentPlatformKey()+"-deb" {
		t.Fatalf("deb 安装应取 -deb 资产键：%q", got)
	}
}
