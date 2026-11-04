//go:build !darwin && !windows && !linux

package updater

import "errors"

// Supported 其余平台暂不发布更新包。
func Supported() (bool, string) {
	return false, "当前平台暂不支持自动更新"
}

// assetKeySuffix 其余平台安装形态不区分更新资产。
func assetKeySuffix() string { return "" }

// Apply 其余平台暂不支持。wantSHA256 供 Linux 的 deb 形态复验安装包，本平台忽略。
func Apply(string, string) error {
	return errors.New("当前平台暂不支持自动更新")
}

// Cleanup 其余平台无需清理。
func Cleanup() {}
