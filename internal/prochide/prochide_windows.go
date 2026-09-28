//go:build windows

package prochide

import (
	"os/exec"
	"syscall"
)

// CREATE_NO_WINDOW：Windows GUI 进程（-H windowsgui 编译）spawn 控制台子程序
// （ssh.exe、cmd.exe 等）时，默认每次都会分配一个新控制台窗口，进程退出即关闭，
// 表现为桌面上的控制台窗口不停闪烁。
const createNoWindow = 0x08000000

// Hide 抑制子进程的控制台窗口，必须在 Start/Run 之前调用；
// 调用方已设置 SysProcAttr 时不覆盖。
func Hide(cmd *exec.Cmd) {
	if cmd == nil || cmd.SysProcAttr != nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
