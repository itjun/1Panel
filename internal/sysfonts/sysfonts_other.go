//go:build !darwin && !windows

package sysfonts

import (
	"os"
	"path/filepath"
)

// Linux 等：直接扫常见字体目录（与 Windows 同一套解析，不依赖 fc-list 是否安装）。
func listPlatform() ([]SystemFont, error) {
	dirs := []string{"/usr/share/fonts", "/usr/local/share/fonts"}
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		dirs = append(dirs, filepath.Join(home, ".local", "share", "fonts"), filepath.Join(home, ".fonts"))
	}
	return scanFontDirs(dirs), nil
}
