package updater

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
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

// debInstalled 报告当前二进制是否登记在 dpkg 数据库（deb 系统包安装）。
// dpkg-query 不存在或查询失败按「非 deb 安装」处理（rpm / 裸二进制）。
func debInstalled() bool {
	exe, err := currentExe()
	if err != nil {
		return false
	}
	out, err := exec.Command("dpkg-query", "--search", exe).Output()
	return err == nil && len(bytes.TrimSpace(out)) > 0
}

func pkexecAvailable() bool {
	_, err := exec.LookPath("pkexec")
	return err == nil
}

// Supported 支持两类安装形态：
//   - deb 系统包安装：经 pkexec 提权安装新 .deb（依赖 polkit，缺 pkexec 时降级为手动更新）；
//   - 用户可写目录里的裸二进制（tar.gz 解压 / build.py 安装）：直接替换二进制。
//
// AppImage 运行在只读挂载里，rpm 等其他系统包形态暂不支持，都需手动下载新包。
func Supported() (bool, string) {
	if os.Getenv("APPIMAGE") != "" {
		return false, "AppImage 版本请到发布页下载新版"
	}
	exe, err := currentExe()
	if err != nil {
		return false, err.Error()
	}
	if debInstalled() {
		if pkexecAvailable() {
			return true, ""
		}
		return false, "系统包安装缺少 pkexec（polkit），请安装后重试或到发布页手动更新"
	}
	if unix.Access(filepath.Dir(exe), unix.W_OK) != nil {
		return false, "安装目录不可写（系统包安装），请用包管理器或到发布页更新"
	}
	return true, ""
}

// assetKeySuffix Linux 按安装形态区分资产：deb 安装用 -deb 后缀取 .deb
// 安装包（dpkg 数据库版本与实际二进制保持一致），裸二进制无后缀。
func assetKeySuffix() string {
	if debInstalled() {
		return "-deb"
	}
	return ""
}

// Apply 安装更新包：deb 形态经 pkexec 提权用 dpkg 安装新 .deb（助手复验
// 清单哈希 wantSHA256）；其余形态从 tar.gz 取出新二进制并原地替换。
func Apply(archive, wantSHA256 string) error {
	if debInstalled() {
		return applyDebViaPKExec(archive, wantSHA256)
	}
	exe, err := currentExe()
	if err != nil {
		return err
	}
	return replaceExeFromTarGz(archive, exe)
}

// applyDebViaPKExec 弹出 polkit 授权框后以 root 运行安装助手。
// 退出码与输出透传；哈希缺失直接拒绝（清单资产必带 sha256）。
func applyDebViaPKExec(debPath, wantSHA256 string) error {
	if wantSHA256 == "" {
		return errors.New("缺少更新包哈希，拒绝安装")
	}
	exe, err := currentExe()
	if err != nil {
		return err
	}
	cmd := exec.Command("pkexec", exe, "update-apply", "--deb", debPath, "--sha256", wantSHA256)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		if tail := outputTail(out.String(), 600); tail != "" {
			return fmt.Errorf("系统包更新失败：%s", tail)
		}
		return fmt.Errorf("系统包更新失败：%w", err)
	}
	return nil
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
