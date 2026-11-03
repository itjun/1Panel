//go:build !linux

package updater

import "os"

// RestartExecutable 返回当前平台重启时使用的程序路径。
func RestartExecutable() (string, error) {
	return os.Executable()
}
