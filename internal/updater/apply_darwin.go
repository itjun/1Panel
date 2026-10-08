package updater

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const stagingPrefix = ".1panel-update-"

// currentBundle 返回正在运行的 .app 路径。
func currentBundle() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	bundle := filepath.Clean(filepath.Join(exe, "..", "..", ".."))
	if !strings.HasSuffix(bundle, ".app") {
		return "", errors.New("当前不是以 .app 方式运行，无法自动更新")
	}
	return bundle, nil
}

// Supported 当前运行方式是否支持自动替换。
func Supported() (bool, string) {
	if _, err := currentBundle(); err != nil {
		return false, err.Error()
	}
	return true, ""
}

// Apply 解压安装包并替换正在运行的 .app。
// 优先在 .app 同目录（同一卷）解压后改名替换；目录不可写时请求管理员授权。
func Apply(archive string) error {
	bundle, err := currentBundle()
	if err != nil {
		return err
	}
	staging, err := os.MkdirTemp(filepath.Dir(bundle), stagingPrefix)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return applyPrivileged(archive, bundle)
		}
		return err
	}
	defer os.RemoveAll(staging)
	newApp, err := extractApp(archive, staging)
	if err != nil {
		return err
	}
	if err := swapPath(bundle, newApp); err != nil {
		if errors.Is(err, os.ErrPermission) {
			return applyPrivileged(archive, bundle)
		}
		return err
	}
	return nil
}

// extractApp 用 ditto 解压（保留符号链接、权限与签名），返回解出的 .app 路径。
func extractApp(archive, dir string) (string, error) {
	if out, err := exec.Command("/usr/bin/ditto", "-x", "-k", archive, dir).CombinedOutput(); err != nil {
		return "", fmt.Errorf("解压安装包失败：%v %s", err, strings.TrimSpace(string(out)))
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasSuffix(e.Name(), ".app") {
			continue
		}
		app := filepath.Join(dir, e.Name())
		if st, err := os.Stat(filepath.Join(app, "Contents", "MacOS")); err != nil || !st.IsDir() {
			return "", errors.New("安装包内的应用结构不完整")
		}
		// Go 下载的文件本不带隔离属性，这里兜底清除，避免 Gatekeeper 拦截启动
		_ = exec.Command("/usr/bin/xattr", "-dr", "com.apple.quarantine", app).Run()
		return app, nil
	}
	return "", errors.New("安装包内没有 .app")
}

// applyPrivileged 通过系统授权框以管理员身份替换；路径经 argv 传入并用 quoted form 转义。
func applyPrivileged(archive, bundle string) error {
	staging, err := os.MkdirTemp("", stagingPrefix)
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	newApp, err := extractApp(archive, staging)
	if err != nil {
		return err
	}
	script := []string{
		"on run argv",
		"set src to item 1 of argv",
		"set dst to item 2 of argv",
		"set bak to dst & \".old\"",
		"do shell script \"/bin/rm -rf \" & quoted form of bak & \" && /bin/mv \" & quoted form of dst & \" \" & quoted form of bak & \" && { /bin/mv \" & quoted form of src & \" \" & quoted form of dst & \" || { /bin/mv \" & quoted form of bak & \" \" & quoted form of dst & \"; exit 1; }; }\" with administrator privileges",
		"end run",
	}
	args := make([]string, 0, len(script)*2+2)
	for _, line := range script {
		args = append(args, "-e", line)
	}
	args = append(args, newApp, bundle)
	if out, err := exec.Command("/usr/bin/osascript", args...).CombinedOutput(); err != nil {
		msg := strings.TrimSpace(string(out))
		if strings.Contains(msg, "-128") {
			return errors.New("已取消管理员授权，更新未安装")
		}
		return fmt.Errorf("以管理员身份替换失败：%s", msg)
	}
	return nil
}

// Cleanup 删除上次更新留下的 .app.old 与解压残留。
func Cleanup() {
	bundle, err := currentBundle()
	if err != nil {
		return
	}
	_ = os.RemoveAll(bundle + ".old")
	entries, err := os.ReadDir(filepath.Dir(bundle))
	if err != nil {
		return
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), stagingPrefix) {
			_ = os.RemoveAll(filepath.Join(filepath.Dir(bundle), e.Name()))
		}
	}
}
