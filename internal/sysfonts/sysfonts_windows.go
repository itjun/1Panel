//go:build windows

package sysfonts

import (
	"os"
	"path/filepath"
)

func listPlatform() ([]SystemFont, error) {
	var dirs []string
	windir := os.Getenv("WINDIR")
	if windir == "" {
		windir = `C:\Windows`
	}
	dirs = append(dirs, filepath.Join(windir, "Fonts"))
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData != "" {
		dirs = append(dirs, filepath.Join(localAppData, "Microsoft", "Windows", "Fonts"))
	}
	return scanFontDirs(dirs), nil
}
