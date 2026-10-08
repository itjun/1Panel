//go:build !darwin && !windows && !linux

package updater

import "errors"

// Supported 其余平台暂不发布更新包。
func Supported() (bool, string) {
	return false, "当前平台暂不支持自动更新"
}

// Apply 其余平台暂不支持。
func Apply(string) error {
	return errors.New("当前平台暂不支持自动更新")
}

// Cleanup 其余平台无需清理。
func Cleanup() {}
