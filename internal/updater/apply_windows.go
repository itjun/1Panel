package updater

import (
	"os"
	"path/filepath"
	"time"
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

// Supported 便携版 exe 始终支持原地替换。
func Supported() (bool, string) {
	if _, err := currentExe(); err != nil {
		return false, err.Error()
	}
	return true, ""
}

// Apply 从 zip 取出新 exe 并原地替换正在运行的 exe。
func Apply(archive string) error {
	exe, err := currentExe()
	if err != nil {
		return err
	}
	return replaceExeFromZip(archive, exe)
}

// Cleanup 删除上次更新留下的 exe.old；旧进程可能尚未完全退出，失败时稍后重试。
func Cleanup() {
	exe, err := currentExe()
	if err != nil {
		return
	}
	for _, p := range []string{exe + ".old", exe + ".new"} {
		for i := 0; i < 5; i++ {
			err := os.Remove(p)
			if err == nil || os.IsNotExist(err) {
				break
			}
			time.Sleep(2 * time.Second)
		}
	}
}
