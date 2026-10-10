//go:build !linux

package main

import "errors"

// 非 Linux 平台的占位实现：调用方已按 runtime.GOOS 分支，这里只为让 macOS / Windows 能编译。

func openHostsInTerminalLinux(hosts []string, mode, terminalID string) error {
	return errors.New("仅 Linux 支持")
}

func listTerminalAppsLinux() []TerminalApp {
	return nil
}
