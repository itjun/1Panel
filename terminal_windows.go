//go:build windows

package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode/utf16"
)

// Windows 终端打开流程：
//  1. 可选终端是已安装的 Windows Terminal 和 PowerShell。设置里选了哪个就用哪个。
//     没选过时优先 Windows Terminal。只剩一个时固定用它。
//  2. Windows Terminal：mode=tab 在最近使用的窗口新建标签页，mode=window 打开新窗口；
//     多台主机在一个窗口里各占一个标签。PowerShell 每台主机一个窗口。
//  3. 连接命令直接交给系统 OpenSSH（ssh.exe）并传 SSH 配置里的 Host 别名。
//     ssh.exe 不可用时返回明确指引。

// resolveSSHExeWin 定位系统 OpenSSH 客户端。
func resolveSSHExeWin() string {
	if root := os.Getenv("SystemRoot"); root != "" {
		p := filepath.Join(root, "System32", "OpenSSH", "ssh.exe")
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	for _, name := range []string{"ssh", "ssh.exe"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

// resolveWTExe 定位 Windows Terminal。
func resolveWTExe() string {
	for _, name := range []string{"wt", "wt.exe"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		p := filepath.Join(local, "Microsoft", "WindowsApps", "wt.exe")
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// buildWTArgs 组装 wt.exe 参数。wt 把独立 argv 元素 ";" 当作子命令分隔符。
func buildWTArgs(sshExe string, hosts []string, mode string) []string {
	args := make([]string, 0, len(hosts)*5+3)
	if mode == "window" {
		// 不带 -w：整组命令在新建窗口中执行
	} else {
		args = append(args, "-w", "0") // 最近使用的 Terminal 窗口
	}
	for i, alias := range hosts {
		if i > 0 {
			args = append(args, ";")
		}
		args = append(args, "new-tab", "--title", alias, sshExe, alias)
	}
	return args
}

const (
	winTerminalWindowsTerminal = "windows-terminal"
	winTerminalPowerShell      = "powershell"
)

func powershellAvailable() bool {
	for _, name := range []string{"powershell.exe", "powershell"} {
		if p, err := exec.LookPath(name); err == nil && p != "" {
			return true
		}
	}
	return false
}

func listTerminalAppsWindows() []TerminalApp {
	apps := make([]TerminalApp, 0, 2)
	if resolveWTExe() != "" {
		apps = append(apps, TerminalApp{ID: winTerminalWindowsTerminal, Name: "Windows Terminal", SupportsWindow: true})
	}
	if powershellAvailable() {
		apps = append(apps, TerminalApp{ID: winTerminalPowerShell, Name: "PowerShell", SupportsWindow: false})
	}
	fallback := winTerminalPowerShell
	if resolveWTExe() != "" {
		fallback = winTerminalWindowsTerminal
	}
	markDefaultTerminal(apps, fallback)
	return apps
}

// openHostsInTerminalWindows 在用户选中的终端里打开主机。没选过时优先 Windows Terminal。
func openHostsInTerminalWindows(hosts []string, mode, terminalID string) error {
	aliases := normalizeTerminalHosts(hosts)
	if len(aliases) == 0 {
		return fmt.Errorf("没有可打开的主机")
	}
	sshExe := resolveSSHExeWin()
	if sshExe == "" {
		return fmt.Errorf(
			"未找到 OpenSSH 客户端（ssh.exe）。安装方式：设置 → 应用 → 可选功能 → 添加功能 →「OpenSSH 客户端」，或在 PowerShell 中执行 Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0。安装后也可以手动连接：ssh %s",
			aliases[0])
	}

	apps := listTerminalAppsWindows()
	fallback := ""
	for _, app := range apps {
		if app.Default {
			fallback = app.ID
		}
	}
	switch chooseListedTerminal(apps, terminalID, fallback) {
	case winTerminalWindowsTerminal:
		wt := resolveWTExe()
		if wt == "" {
			return fmt.Errorf("未找到 Windows Terminal")
		}
		cmd := exec.Command(wt, buildWTArgs(sshExe, aliases, mode)...)
		// wt 是 GUI 程序，Start 后即返回；启动失败才报错
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("启动 Windows Terminal 失败: %w", err)
		}
		_ = cmd.Process.Release()
		return nil
	case winTerminalPowerShell:
		for _, alias := range aliases {
			if err := openSSHInPowerShell(sshExe, alias); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("未找到可用的终端")
	}
}

func openSSHInPowerShell(sshExe, alias string) error {
	ps := exec.Command("powershell.exe", "-NoExit", "-EncodedCommand",
		encodePowerShellCommand(fmt.Sprintf("& '%s' '%s'",
			strings.ReplaceAll(sshExe, "'", "''"),
			strings.ReplaceAll(alias, "'", "''"))))
	// 注意不要 prochide.Hide：这个 PowerShell 窗口就是降级后的终端，必须可见
	if err := ps.Start(); err != nil {
		return fmt.Errorf("未找到 Windows Terminal，且启动 PowerShell 失败: %w", err)
	}
	_ = ps.Process.Release()
	return nil
}

func encodePowerShellCommand(script string) string {
	units := utf16.Encode([]rune(script))
	b := make([]byte, len(units)*2)
	for i, u := range units {
		b[i*2] = byte(u)
		b[i*2+1] = byte(u >> 8)
	}
	return base64.StdEncoding.EncodeToString(b)
}
