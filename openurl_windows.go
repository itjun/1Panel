//go:build windows

package main

import (
	"fmt"

	"golang.org/x/sys/windows"
)

// openURLWindows 用 ShellExecute 以系统默认浏览器打开链接。
// 不经 cmd /c start（那是 shell 拼接面），URL 已在上层校验为 http(s)。
func openURLWindows(target string) error {
	verb, err := windows.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	const swShowNormal = 1
	if err := windows.ShellExecute(0, verb, file, nil, nil, swShowNormal); err != nil {
		return fmt.Errorf("无法打开浏览器: %w", err)
	}
	return nil
}
