//go:build !windows

package prochide

import "os/exec"

// Hide 在非 Windows 平台是 no-op：其它桌面平台 spawn 子进程不会弹控制台窗口。
func Hide(*exec.Cmd) {}
