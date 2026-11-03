package updater

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

// Linux 的 /proc/self/exe 会跟随 rename 改成 .old，必须在替换前固定安装路径。
var installedExe, installedExeErr = resolveInstalledExe()

func currentExe() (string, error) {
	return installedExe, installedExeErr
}

// RestartExecutable 与 Apply 使用同一个路径，避免更新后重新启动旧备份。
func RestartExecutable() (string, error) {
	return currentExe()
}

func resolveInstalledExe() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	// 兼容旧版错误地从备份启动的情况，只识别本应用的备份名。
	if filepath.Base(exe) == "1Panel.old" {
		target := strings.TrimSuffix(exe, ".old")
		st, err := os.Stat(target)
		if err != nil {
			return "", fmt.Errorf("无法找到更新后的程序 %s：%w", target, err)
		}
		if !st.Mode().IsRegular() || st.Mode().Perm()&0o111 == 0 {
			return "", fmt.Errorf("更新后的程序不可执行：%s", target)
		}
		exe = target
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
