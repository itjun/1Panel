//go:build darwin

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// macOS 终端打开流程：
//  1. 可选终端是已安装的 1Agent（包标识 com.itjun.1agent）、官方 Ghostty
//     （包标识 com.mitchellh.ghostty、可执行文件 ghostty、团队 24VZTF6M5V）、
//     官方 Otty（包标识 io.appmakes.otty、可执行文件 Otty、团队 9HWK5273G4）
//     和系统「终端」。同名但身份不符的应用不列出。
//  2. 设置里选了哪个就用哪个。没选过时优先官方 Ghostty，其次 1Agent，再次 Otty，
//     都没有则用系统「终端」。只剩一个可用时固定用它。
//  3. 1Agent 走 oneagent://open。其余把连接交给 ssh 和 SSH 配置里的 Host 别名。
//     系统「终端」和 Otty 固定在已有窗口新建标签页，不提供「新窗口」选项；
//     要新窗口由用户在对应终端里自己操作。没有窗口时，系统「终端」仍会先出现一个窗口。
//     Ghostty 在 macOS 上没有新窗口动作，-e 只会在正在运行的 Ghostty 里再开一个终端。
//     Otty 没在运行时，标签页会退回新窗口，否则无法启动。打开后把 Otty 切到前台。

const (
	oneAgentBundleID          = "com.itjun.1agent"
	oneAgentExecutable        = "1Agent"
	officialGhosttyBundleID   = "com.mitchellh.ghostty"
	officialGhosttyExecutable = "ghostty"
	officialGhosttyTeamID     = "24VZTF6M5V"
	officialOttyBundleID      = "io.appmakes.otty"
	officialOttyExecutable    = "Otty"
	officialOttyTeamID        = "9HWK5273G4"
)

type macTerminalKind string

const (
	macTerminal1Agent   macTerminalKind = "1Agent"
	macTerminalGhostty  macTerminalKind = "Ghostty"
	macTerminalOtty     macTerminalKind = "Otty"
	macTerminalTerminal macTerminalKind = "Terminal"
)

type macAppInfo struct {
	path       string
	bundleID   string
	executable string
	teamID     string
}

type macTerminalChoice struct {
	kind    macTerminalKind
	appPath string // Ghostty 或 Otty 的 .app 路径
}

type macOpenPlan struct {
	kind     macTerminalKind
	openURL  string     // 1Agent
	commands [][]string // Ghostty：交给 open 的参数。Otty：otty-cli 的完整参数，argv[0] 是 otty-cli
	scripts  []string   // 系统「终端」：每台主机一段 AppleScript
}

const (
	macTerminal1AgentID   = "1agent"
	macTerminalGhosttyID  = "ghostty"
	macTerminalOttyID     = "otty"
	macTerminalTerminalID = "terminal"
)

func listMacTerminalApps(lookup func(string) (macAppInfo, bool)) []TerminalApp {
	apps := make([]TerminalApp, 0, 4)
	fallback := macTerminalTerminalID
	if info, ok := lookup("1Agent"); ok && isOneAgent(info) {
		apps = append(apps, TerminalApp{ID: macTerminal1AgentID, Name: "1Agent", SupportsWindow: false})
		fallback = macTerminal1AgentID
	}
	if info, ok := lookup("Ghostty"); ok && isOfficialGhostty(info) {
		apps = append(apps, TerminalApp{ID: macTerminalGhosttyID, Name: "Ghostty", SupportsWindow: false})
		fallback = macTerminalGhosttyID
	}
	if info, ok := lookup("Otty"); ok && isOfficialOtty(info) {
		apps = append(apps, TerminalApp{ID: macTerminalOttyID, Name: "Otty", SupportsWindow: false})
		if fallback == macTerminalTerminalID {
			fallback = macTerminalOttyID
		}
	}
	apps = append(apps, TerminalApp{ID: macTerminalTerminalID, Name: "系统终端", SupportsWindow: false})
	markDefaultTerminal(apps, fallback)
	return apps
}

func listTerminalAppsDarwin() []TerminalApp {
	return listMacTerminalApps(lookupMacApp)
}

// chooseMacTerminal 按设置里的终端 id 取一个可用终端。
func chooseMacTerminal(lookup func(string) (macAppInfo, bool), terminalID string) macTerminalChoice {
	apps := listMacTerminalApps(lookup)
	fallback := macTerminalTerminalID
	var ghosttyPath, ottyPath string
	for _, app := range apps {
		if app.Default {
			fallback = app.ID
		}
	}
	if info, ok := lookup("Ghostty"); ok && isOfficialGhostty(info) {
		ghosttyPath = info.path
	}
	if info, ok := lookup("Otty"); ok && isOfficialOtty(info) {
		ottyPath = info.path
	}
	switch chooseListedTerminal(apps, terminalID, fallback) {
	case macTerminal1AgentID:
		return macTerminalChoice{kind: macTerminal1Agent}
	case macTerminalGhosttyID:
		return macTerminalChoice{kind: macTerminalGhostty, appPath: ghosttyPath}
	case macTerminalOttyID:
		return macTerminalChoice{kind: macTerminalOtty, appPath: ottyPath}
	default:
		return macTerminalChoice{kind: macTerminalTerminal}
	}
}

func isOneAgent(info macAppInfo) bool {
	return info.path != "" &&
		info.bundleID == oneAgentBundleID &&
		info.executable == oneAgentExecutable
}

func isOfficialOtty(info macAppInfo) bool {
	return info.path != "" &&
		info.bundleID == officialOttyBundleID &&
		info.executable == officialOttyExecutable &&
		info.teamID == officialOttyTeamID
}

func isOfficialGhostty(info macAppInfo) bool {
	return info.path != "" &&
		info.bundleID == officialGhosttyBundleID &&
		info.executable == officialGhosttyExecutable &&
		info.teamID == officialGhosttyTeamID
}

func lookupMacApp(name string) (macAppInfo, bool) {
	cmd := exec.Command("osascript", "-e", "POSIX path of (path to application "+appleScriptString(name)+")")
	out, err := cmd.Output()
	if err != nil {
		return macAppInfo{}, false
	}
	path := strings.TrimRight(strings.TrimSpace(string(out)), "/")
	if path == "" {
		return macAppInfo{}, false
	}
	return macAppInfo{
		path:       path,
		bundleID:   readPlistString(path, "CFBundleIdentifier"),
		executable: readPlistString(path, "CFBundleExecutable"),
		teamID:     readTeamID(path),
	}, true
}

func readPlistString(appPath, key string) string {
	plist := filepath.Join(appPath, "Contents", "Info.plist")
	cmd := exec.Command("/usr/libexec/PlistBuddy", "-c", "Print :"+key, plist)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func readTeamID(appPath string) string {
	cmd := exec.Command("codesign", "-dv", "--verbose=4", appPath)
	out, _ := cmd.CombinedOutput()
	for _, line := range strings.Split(string(out), "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "TeamIdentifier="); ok {
			return strings.TrimSpace(rest)
		}
	}
	return ""
}

func macSSHPath() (string, error) {
	if p, err := exec.LookPath("ssh"); err == nil {
		return p, nil
	}
	const fallback = "/usr/bin/ssh"
	if st, err := os.Stat(fallback); err == nil && !st.IsDir() {
		return fallback, nil
	}
	return "", fmt.Errorf("未找到 ssh 客户端")
}

func planMacOpen(choice macTerminalChoice, hosts []string, mode, sshExe string) (macOpenPlan, error) {
	// 调用方可能仍传来 window（旧设置）。macOS 一律开标签页。
	_ = mode
	if choice.kind == macTerminal1Agent {
		url, err := oneagentOpenURL(hosts)
		if err != nil {
			return macOpenPlan{}, err
		}
		return macOpenPlan{kind: choice.kind, openURL: url}, nil
	}
	aliases := normalizeTerminalHosts(hosts)
	if len(aliases) == 0 {
		return macOpenPlan{}, fmt.Errorf("没有可打开的主机")
	}
	plan := macOpenPlan{kind: choice.kind}
	switch choice.kind {
	case macTerminalGhostty:
		appPath := choice.appPath
		if appPath == "" {
			return macOpenPlan{}, fmt.Errorf("未找到官方 Ghostty")
		}
		for _, alias := range aliases {
			plan.commands = append(plan.commands, []string{"-na", appPath, "--args", "-e", sshExe, "--", alias})
		}
	case macTerminalOtty:
		if choice.appPath == "" {
			return macOpenPlan{}, fmt.Errorf("未找到官方 Otty")
		}
		cli := filepath.Join(choice.appPath, "Contents", "MacOS", "otty-cli")
		for _, alias := range aliases {
			plan.commands = append(plan.commands, ottyLaunchArgs(cli, sshExe, alias, true))
		}
	default:
		for _, alias := range aliases {
			plan.scripts = append(plan.scripts, terminalAppOpenScript(sshCommand(sshExe, alias), false))
		}
	}
	return plan, nil
}

func sshCommand(sshExe, alias string) string {
	return "exec " + sshExe + " " + shellSingleQuote(alias)
}

// ottyLaunchArgs 组装 otty-cli 参数。newTab 在已运行的 Otty 里开标签页。
// 不传 --title：Otty 会按当前进程自己填标签名。写死主机名后，重启 Otty
// 会话回到本地目录时，标签仍停在主机名上。
// 命令经 Otty 的 /bin/sh -c 执行，所以路径和别名都加引号。
func ottyLaunchArgs(cli, sshExe, alias string, newTab bool) []string {
	command := "exec " + shellSingleQuote(sshExe) + " -- " + shellSingleQuote(alias)
	if newTab {
		return []string{cli, "tab", "new", "--json", "--command", command}
	}
	return []string{cli, "open", "--json", "--command", command}
}

func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func appleScriptString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\', '"':
			b.WriteByte('\\')
			b.WriteRune(r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

func terminalAppOpenScript(command string, newWindow bool) string {
	// 固定新标签页。没有「辅助功能」权限时，⌘T 会被系统拒绝，这时改为新窗口，避免打不开。
	_ = newWindow
	quoted := appleScriptString(command)
	return fmt.Sprintf(`tell application "Terminal"
    activate
    if (count of windows) = 0 then
        do script %s
    else
        try
            tell application "System Events" to tell process "Terminal" to keystroke "t" using {command down}
            delay 0.4
            do script %s in selected tab of front window
        on error
            do script %s
        end try
    end if
end tell
`, quoted, quoted, quoted)
}

func hasOpenableTerminalHost(hosts []string) bool {
	for _, host := range hosts {
		alias := strings.TrimSpace(host)
		if alias != "" && !strings.ContainsAny(alias, "\r\n") {
			return true
		}
	}
	return false
}

func openHostsInTerminalDarwin(hosts []string, mode, terminalID string) error {
	if !hasOpenableTerminalHost(hosts) {
		return fmt.Errorf("没有可打开的主机")
	}
	choice := chooseMacTerminal(lookupMacApp, terminalID)
	sshExe := ""
	if choice.kind != macTerminal1Agent {
		var err error
		sshExe, err = macSSHPath()
		if err != nil {
			return err
		}
	}
	plan, err := planMacOpen(choice, hosts, mode, sshExe)
	if err != nil {
		return err
	}
	return runMacOpenPlan(plan)
}

func runMacOpenPlan(plan macOpenPlan) error {
	switch plan.kind {
	case macTerminal1Agent:
		if err := runOpenCommand(plan.openURL); err != nil {
			return fmt.Errorf("无法打开 1Agent: %w", err)
		}
		return nil
	case macTerminalGhostty:
		for _, args := range plan.commands {
			if err := runOpenCommand(args...); err != nil {
				return fmt.Errorf("无法打开 Ghostty: %w", err)
			}
		}
		return nil
	case macTerminalOtty:
		for _, args := range plan.commands {
			if err := runOttyCommand(args); err != nil {
				return fmt.Errorf("无法打开 Otty: %w", err)
			}
		}
		return nil
	default:
		for _, script := range plan.scripts {
			if err := runOSAScript(script); err != nil {
				return fmt.Errorf("无法打开终端: %w", err)
			}
		}
		return nil
	}
}

// runOttyCommand 执行 otty-cli。标签页要求 Otty 已在运行；失败时改开新窗口。
// 成功后聚焦新建的标签页，并把 Otty 窗口切到前台。
func runOttyCommand(args []string) error {
	out, err := runDirectCommandOutput(args)
	if err != nil {
		if len(args) < 3 || args[1] != "tab" {
			return err
		}
		retry := append([]string{args[0], "open"}, args[3:]...)
		if err = runDirectCommand(retry); err != nil {
			return err
		}
		return activateMacApp(ottyAppPath(args[0]))
	}
	if id := ottyCreatedTabID(out); id != "" {
		_ = runDirectCommand([]string{args[0], "tab", "focus", id})
	}
	return activateMacApp(ottyAppPath(args[0]))
}

func ottyAppPath(cli string) string {
	return filepath.Dir(filepath.Dir(filepath.Dir(cli)))
}

func ottyCreatedTabID(out string) string {
	var resp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(out), &resp); err != nil {
		return ""
	}
	return resp.Data.ID
}

func activateMacApp(appPath string) error {
	if !strings.HasSuffix(appPath, ".app") {
		return fmt.Errorf("无法切换到终端")
	}
	if err := runOpenCommand(appPath); err != nil {
		return err
	}
	name := strings.TrimSuffix(filepath.Base(appPath), ".app")
	cmd := exec.Command("osascript", "-e", "tell application "+appleScriptString(name)+" to activate")
	_, _ = cmd.CombinedOutput()
	return nil
}

func runDirectCommandOutput(args []string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("空命令")
	}
	cmd := exec.Command(args[0], args[1:]...)
	out, err := cmd.CombinedOutput()
	msg := strings.TrimSpace(string(out))
	if err != nil {
		if msg == "" {
			return "", err
		}
		return msg, fmt.Errorf("%s", msg)
	}
	return msg, nil
}

func runDirectCommand(args []string) error {
	_, err := runDirectCommandOutput(args)
	return err
}

func runOpenCommand(args ...string) error {
	cmd := exec.Command("open", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return err
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}

func runOSAScript(script string) error {
	cmd := exec.Command("osascript", "-")
	cmd.Stdin = strings.NewReader(script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return err
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}
