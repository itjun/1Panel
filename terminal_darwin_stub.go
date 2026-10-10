//go:build !darwin

package main

import "errors"

// 非 macOS 平台的占位实现：调用方已按 runtime.GOOS 分支，这里只为让 Windows / Linux 能编译。

func openHostsInTerminalDarwin(hosts []string, mode, terminalID string) error {
	return errors.New("仅 macOS 支持")
}

func listTerminalAppsDarwin() []TerminalApp {
	return nil
}
