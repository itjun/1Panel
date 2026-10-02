//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Linux 终端打开流程：
//  1. 探测系统终端：$TERMINAL 环境变量优先（用户显式指定，可带自身参数），
//     其次 x-terminal-emulator（Debian/Ubuntu 指向系统默认终端的 alternatives
//     链接，解析真实指向后按对应终端的参数规格调用），再次 xdg-terminal-exec
//     （freedesktop 默认终端规范，GNOME 等新桌面经它取系统设置的默认终端），
//     最后逐个探测常见终端模拟器。
//  2. mode=tab 时对支持的终端（gnome-terminal / konsole / xfce4-terminal /
//     mate-terminal）在已有窗口新建标签页，多台主机各占一个标签；不支持标签
//     页的终端 mode 退化为逐台各开一个窗口。
//  3. 连接命令交给系统 ssh 客户端并传 SSH 配置里的 Host 别名，端口 / 密钥 /
//     跳板机等全部由 ssh 读用户自己的 ~/.ssh/config 解析，面板不重新拼连接
//     参数，配置不会丢失。

// linuxTerminalSpec 描述一款终端如何执行外部命令。
type linuxTerminalSpec struct {
	bin      string   // 可执行文件名
	cmdArgs  []string // 执行命令用的固定前缀参数；空表示命令以位置参数直接跟随
	tabArgs  []string // mode=tab 时追加的参数；空表示不支持标签页
}

// 已知终端的调用规格。执行命令的前缀按各终端实际语义区分：
// gnome-terminal / mate-terminal 用 --，xfce4-terminal 用 -x（-e 只吃单字符串），
// kitty / foot 直接跟位置参数，konsole / alacritty / xterm 等用 -e 多参数。
var linuxTerminalSpecs = []linuxTerminalSpec{
	{bin: "gnome-terminal", cmdArgs: []string{"--"}, tabArgs: []string{"--tab"}},
	{bin: "konsole", cmdArgs: []string{"-e"}, tabArgs: []string{"--new-tab"}},
	{bin: "xfce4-terminal", cmdArgs: []string{"-x"}, tabArgs: []string{"--tab"}},
	{bin: "mate-terminal", cmdArgs: []string{"--"}, tabArgs: []string{"--tab"}},
	{bin: "kitty"},
	{bin: "alacritty", cmdArgs: []string{"-e"}},
	{bin: "foot"},
	{bin: "wezterm", cmdArgs: []string{"start", "--"}},
	{bin: "tilix", cmdArgs: []string{"-e"}},
	{bin: "urxvt", cmdArgs: []string{"-e"}},
	{bin: "xterm", cmdArgs: []string{"-e"}},
}

// specForBinary 按可执行文件名匹配调用规格，未登记的终端按最通用的
// 「-e 命令 参数…」多参数形态兜底（xterm / konsole / lxterminal 等同款语义）。
func specForBinary(bin string) linuxTerminalSpec {
	for _, spec := range linuxTerminalSpecs {
		if spec.bin == bin {
			return spec
		}
	}
	return linuxTerminalSpec{bin: bin, cmdArgs: []string{"-e"}}
}

// resolveLinuxTerminal 按优先级探测可用的终端模拟器。
func resolveLinuxTerminal() (string, linuxTerminalSpec, error) {
	// $TERMINAL 支持带自身参数（如 "kitty --single-instance"）：
	// 首个词是可执行文件，其余词原样跟在调用参数里
	if env := strings.TrimSpace(os.Getenv("TERMINAL")); env != "" {
		fields := strings.Fields(env)
		if p, err := exec.LookPath(fields[0]); err == nil {
			spec := specForBinary(filepath.Base(p))
			spec.cmdArgs = append(fields[1:], spec.cmdArgs...)
			return p, spec, nil
		}
	}
	// Debian/Ubuntu：alternatives 链接指向系统默认终端，解析后直接以真实路径
	// 调用：既拿到系统默认终端，又让 argv[0] 与参数规格匹配，规避各终端 -e
	// 语义差异（如链接指向 xfce4-terminal 时 -e 会丢参数）
	if p, err := exec.LookPath("x-terminal-emulator"); err == nil {
		if resolved, err := filepath.EvalSymlinks(p); err == nil {
			return resolved, specForBinary(filepath.Base(resolved)), nil
		}
		return p, specForBinary("x-terminal-emulator"), nil
	}
	// freedesktop 默认终端规范：命令以位置参数直接跟随
	if p, err := exec.LookPath("xdg-terminal-exec"); err == nil {
		return p, linuxTerminalSpec{bin: "xdg-terminal-exec"}, nil
	}
	for _, spec := range linuxTerminalSpecs {
		if p, err := exec.LookPath(spec.bin); err == nil {
			return p, spec, nil
		}
	}
	return "", linuxTerminalSpec{}, fmt.Errorf(
		"未找到可用的终端模拟器。可安装 gnome-terminal / konsole / xfce4-terminal / xterm 等任意一个，或设置 $TERMINAL 环境变量指定")
}

// buildLinuxTerminalArgs 组装在终端里执行 ssh 的完整参数。
func buildLinuxTerminalArgs(spec linuxTerminalSpec, sshExe, alias, mode string) []string {
	var args []string
	if mode != "window" && len(spec.tabArgs) > 0 {
		args = append(args, spec.tabArgs...)
	}
	args = append(args, spec.cmdArgs...)
	return append(args, sshExe, alias)
}

// openHostsInTerminalLinux 在系统终端中打开主机终端，逐台启动。
func openHostsInTerminalLinux(hosts []string, mode string) error {
	aliases := normalizeTerminalHosts(hosts)
	if len(aliases) == 0 {
		return fmt.Errorf("没有可打开的主机")
	}
	sshExe, err := exec.LookPath("ssh")
	if err != nil {
		return fmt.Errorf(
			"未找到 ssh 客户端，请先安装（Debian/Ubuntu: sudo apt install openssh-client）。安装前也可以手动连接：ssh %s",
			aliases[0])
	}
	termPath, spec, err := resolveLinuxTerminal()
	if err != nil {
		return err
	}
	for _, alias := range aliases {
		// 终端是 GUI 程序（或立即转交单实例服务），Start 后即返回；启动失败才报错
		cmd := exec.Command(termPath, buildLinuxTerminalArgs(spec, sshExe, alias, mode)...)
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("启动终端 %s 失败: %w", spec.bin, err)
		}
		_ = cmd.Process.Release()
	}
	return nil
}
