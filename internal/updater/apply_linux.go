package updater

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func currentExe() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return exe, nil
}

// Supported 只支持用户可写目录里的裸二进制（如 build.py 装到 ~/.local/bin）。
// AppImage 运行在只读挂载里，deb / rpm 装在系统目录，都需要用户手动下载新包。
func Supported() (bool, string) {
	if os.Getenv("APPIMAGE") != "" {
		return false, "AppImage 版本请到发布页下载新版"
	}
	exe, err := currentExe()
	if err != nil {
		return false, err.Error()
	}
	if unix.Access(filepath.Dir(exe), unix.W_OK) != nil {
		return false, "安装目录不可写（系统包安装），请用包管理器或到发布页更新"
	}
	return true, ""
}

// Apply 从 tar.gz 取出新二进制并原地替换正在运行的二进制。
func Apply(archive string) error {
	exe, err := currentExe()
	if err != nil {
		return err
	}
	return replaceExeFromTarGz(archive, exe)
}

// Cleanup 删除上次更新留下的 .old / .new。
func Cleanup() {
	exe, err := currentExe()
	if err != nil {
		return
	}
	_ = os.Remove(exe + ".old")
	_ = os.Remove(exe + ".new")
}
