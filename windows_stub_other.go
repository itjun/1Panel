//go:build !windows

package main

import "errors"

// 非 Windows 平台的占位实现：调用方已按 runtime.GOOS 分支，这里只为让 macOS / Linux 能编译。

func openURLWindows(target string) error {
	return errors.New("仅 Windows 支持")
}

func openHostsInTerminalWindows(hosts []string, mode, terminalID string) error {
	return errors.New("仅 Windows 支持")
}

func listTerminalAppsWindows() []TerminalApp {
	return nil
}
