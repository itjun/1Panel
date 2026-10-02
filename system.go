package main

import (
	"fmt"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"diteng-pannel/internal/boardhttp"
	"diteng-pannel/internal/desktop"
	"diteng-pannel/internal/groupid"
	"diteng-pannel/internal/macui"
	"diteng-pannel/internal/menucheck"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/prochide"
	"diteng-pannel/internal/sysfonts"
	"diteng-pannel/internal/wecom"
	"diteng-pannel/internal/winui"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// SetTrafficLightsHidden 隐藏/恢复 macOS 窗口红绿灯按钮
// 供前端卡片最大化时调用：最大化期间隐藏，退出时恢复。
// v3 原生支持按钮状态控制（替代 v2 的 cgo/AppKit 实现）。
func (s *System) SetTrafficLightsHidden(hidden bool) {
	w := s.mainWindow
	if w == nil {
		return
	}
	st := application.ButtonEnabled
	if hidden {
		st = application.ButtonHidden
	}
	w.SetCloseButtonState(st)
	w.SetMinimiseButtonState(st)
	w.SetMaximiseButtonState(st)
	if !hidden {
		macui.InstallCenteredTrafficLights(w, macTrafficLightBand)
	}
}

// GetAskBeforeQuit ⌘Q / 应用菜单退出前是否先确认（挂后台或彻底退出）。
func (s *System) GetAskBeforeQuit() bool {
	return loadAskBeforeQuit()
}

// SetAskBeforeQuit 设置「退出前询问」；与确认框内勾选写入同一份配置。
func (s *System) SetAskBeforeQuit(ask bool) {
	saveAskBeforeQuit(ask)
	if s.app != nil {
		s.app.Event.Emit("ask-before-quit-changed", ask)
	}
}

// SetThemeAppearance 同步窗口原生外观：light / dark / auto（跟随系统）。
func (s *System) SetThemeAppearance(mode string) {
	switch mode {
	case string(macui.AppearanceDark):
		s.themeAppearance = macui.AppearanceDark
	case string(macui.AppearanceAuto):
		s.themeAppearance = macui.AppearanceAuto
	default:
		s.themeAppearance = macui.AppearanceLight
	}
	s.applyAppearanceOnWindow(s.mainWindow)
}

// ListSystemFonts 本机已安装的字体家族（设置页「自定义字体」列表用）；进程内只读一次。
func (s *System) ListSystemFonts() ([]sysfonts.SystemFont, error) {
	return sysfonts.List()
}

func (s *System) applyAppearanceOnWindow(win *application.WebviewWindow) {
	if win == nil {
		return
	}
	mode := s.themeAppearance
	if mode == "" {
		mode = macui.AppearanceLight
	}
	macui.SetWindowAppearance(win, mode)
}

// BoardHTTPConfig 看板 HTTP 网关配置（供前端设置页）。
type BoardHTTPConfig struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port"`
}

// GetBoardHTTPConfig 返回当前看板 HTTP 开关与端口。
func (s *System) GetBoardHTTPConfig() BoardHTTPConfig {
	if s.boardHTTP != nil {
		c := s.boardHTTP.Config()
		return BoardHTTPConfig{Enabled: c.Enabled, Port: c.Port}
	}
	c := boardhttp.LoadConfig("ServerPanel")
	return BoardHTTPConfig{Enabled: c.Enabled, Port: c.Port}
}

// SetBoardHTTPConfig 保存并热重载看板 HTTP 监听。
func (s *System) SetBoardHTTPConfig(cfg BoardHTTPConfig) error {
	next := boardhttp.Config{Enabled: cfg.Enabled, Port: cfg.Port}
	if next.Port <= 0 {
		next.Port = boardhttp.DefaultPort
	}
	if err := boardhttp.SaveConfig("ServerPanel", next); err != nil {
		return err
	}
	if s.boardHTTP == nil {
		(*App)(s).startBoardHTTP()
		if s.boardHTTP == nil {
			return fmt.Errorf("看板 HTTP 未启动")
		}
		return nil
	}
	return s.boardHTTP.Apply(next)
}

// ListBoardURLs 返回该分组在本机私网 IP 上的看板链接。
// groupName 为空时只返回 http://ip:port 基址（设置页示例）。
func (s *System) ListBoardURLs(groupName string) ([]string, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName != "" {
		if err := groupid.Validate(groupName); err != nil {
			return nil, err
		}
	}
	port := boardhttp.DefaultPort
	if s.boardHTTP != nil {
		c := s.boardHTTP.Config()
		if !c.Enabled {
			return nil, fmt.Errorf("看板 HTTP 未开启")
		}
		port = c.Port
	} else {
		c := boardhttp.LoadConfig("ServerPanel")
		if !c.Enabled {
			return nil, fmt.Errorf("看板 HTTP 未开启")
		}
		port = c.Port
	}
	return boardhttp.BuildURLs(port, groupName), nil
}

// OpenBoardInBrowser 用系统浏览器打开该分组看板（取第一条私网 URL）。
func (s *System) OpenBoardInBrowser(groupName string) error {
	urls, err := s.ListBoardURLs(groupName)
	if err != nil {
		return err
	}
	if len(urls) == 0 {
		return fmt.Errorf("无可用内网地址")
	}
	return openSystemURL(urls[0])
}

func openSystemURL(target string) error {
	switch runtime.GOOS {
	case "windows":
		// ShellExecute 直调，避免 cmd /c start 的 shell 拼接面
		return openURLWindows(target)
	case "darwin":
		return runURLOpenner(exec.Command("open", target))
	default:
		return runURLOpenner(exec.Command("xdg-open", target))
	}
}

func runURLOpenner(cmd *exec.Cmd) error {
	prochide.Hide(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return fmt.Errorf("无法打开浏览器: %w", err)
		}
		return fmt.Errorf("无法打开浏览器: %s", msg)
	}
	return nil
}

// FocusMainWindow 显示并聚焦主窗口。
// 从后台挂起恢复时先把 Dock 图标加回来（Regular），再出示窗口。
func (s *System) FocusMainWindow() {
	w := s.mainWindow
	if w == nil {
		return
	}
	macui.SetDockIconVisible(true)
	winui.SetHiddenOnTaskbar(w, false)
	w.Show()
	w.Focus()
}

// GetMyEgress 查询本机出口公网 IP 与归属地（来自 myip.ipip.net）
// 用于设置页本机信息。不依赖任何主机。
func (s *System) GetMyEgress() (monitor.EgressInfo, error) {
	return monitor.FetchEgress()
}

// NotifyHostConn 面板检测到主机连接失败 / 恢复时发送企微告警。
// 与 agent 侧 jar 探活告警共用同一 webhook 与 markdown 版式。
func (s *System) NotifyHostConn(in HostConnNotify) error {
	webhook := strings.TrimSpace(in.Webhook)
	if webhook == "" {
		return nil
	}
	host := strings.TrimSpace(in.Host)
	if host == "" {
		return nil
	}
	kind := strings.TrimSpace(in.Kind)
	n := wecom.WatchNotify{
		Host:     host,
		Kind:     kind,
		Detail:   strings.TrimSpace(in.Detail),
		NotifyAt: time.Now(),
		Source:   wecom.LocalSource(),
	}
	if kind == "up" {
		n.Level = "ok"
		n.TitleSuffix = "主机已恢复"
		if n.Detail == "" {
			n.Detail = "连接已恢复"
		}
	} else {
		n.Level = "critical"
		n.TitleSuffix = "主机连接失败"
		n.Kind = "down"
		if n.Detail == "" {
			n.Detail = "连接失败"
		}
	}
	return wecom.NotifyWecom(webhook, wecom.FormatWatchMarkdown(n))
}

// NotifyHostAlert 面板检测到 CPU/内存/磁盘/负载超阈值或回落、应用探活异常/恢复、证书到期/续期时发企微。
func (s *System) NotifyHostAlert(in HostAlertNotify) error {
	webhook := strings.TrimSpace(in.Webhook)
	if webhook == "" {
		return nil
	}
	if strings.TrimSpace(in.Host) == "" {
		return nil
	}
	return wecom.NotifyWecom(webhook, hostAlertMarkdown(in))
}

// PreviewHostAlertMarkdown 返回企微将收到的 markdown 原文（不发送），供设置页预览。
func (s *System) PreviewHostAlertMarkdown(in HostAlertNotify) string {
	return hostAlertMarkdown(in)
}

func hostAlertMarkdown(in HostAlertNotify) string {
	host := strings.TrimSpace(in.Host)
	kind := strings.TrimSpace(in.Kind)
	up := strings.TrimSpace(in.State) == "up"
	n := wecom.WatchNotify{
		Host:     host,
		Kind:     kind,
		Detail:   strings.TrimSpace(in.Detail),
		NotifyAt: time.Now(),
		Source:   wecom.LocalSource(),
		Title:    strings.TrimSpace(in.Title),
		Lines:    in.Lines,
	}
	if n.Title != "" {
		switch level := strings.TrimSpace(in.Level); {
		case up:
			n.Level = "ok"
		case level == "warn":
			n.Level = "warning"
		case level == "danger":
			n.Level = "critical"
		case kind == "cert" && !in.Expired:
			n.Level = "warning"
		default:
			n.Level = "critical"
		}
		return wecom.FormatWatchMarkdown(n)
	}
	if kind == "cert" {
		// 与系统通知、应用内同一套标题和正文，不另加严重级别和来源行。
		text := strings.TrimSpace(in.TitleSuffix)
		detail := strings.TrimSpace(in.Detail)
		switch {
		case text == "":
			text = detail
		case detail != "":
			text = text + "\n" + detail
		}
		if text == "" {
			text = "证书到期"
		}
		return text
	}
	if strings.HasPrefix(kind, "app:") {
		svc := strings.TrimPrefix(kind, "app:")
		if svc == "" {
			svc = "应用"
		}
		if up {
			n.Level = "ok"
			n.TitleSuffix = svc + " 已恢复"
			if n.Detail == "" {
				n.Detail = "探活已恢复"
			}
		} else {
			n.Level = "critical"
			n.TitleSuffix = svc + " 探活异常"
			if n.Detail == "" {
				n.Detail = "探活异常"
			}
		}
		return wecom.FormatWatchMarkdown(n)
	}
	label := resourceAlertLabel(kind)
	if up {
		n.Level = "ok"
		n.TitleSuffix = label + "已回落"
		if n.Detail == "" {
			n.Detail = label + "已恢复到阈值以下"
		}
	} else {
		n.Level = "critical"
		n.TitleSuffix = label + "超阈值"
		if n.Detail == "" {
			n.Detail = label + "超过警戒阈值"
		}
	}
	return wecom.FormatWatchMarkdown(n)
}

// NotifyDesktop 本机系统通知（Wails 原生通知中心）。
// 未获授权时静默空操作；点击通知会 FocusMainWindow 并 Emit alert-open-host。
func (s *System) NotifyDesktop(in DesktopNotify) error {
	return desktop.Notify(desktop.Payload{
		Title:   in.Title,
		Body:    in.Body,
		Host:    in.Host,
		EventID: in.EventID,
		Kind:    in.Kind,
	})
}

func resourceAlertLabel(kind string) string {
	switch kind {
	case "mem":
		return "内存"
	case "cpu":
		return "CPU"
	case "disk":
		return "磁盘"
	case "load":
		return "负载"
	default:
		return kind
	}
}

// TestWecomWebhook 向企业微信群机器人发一条测试消息，确认地址可用。
// 空地址或企微拒绝时返回错误；前端据此决定能否保存新地址。
func (s *System) TestWecomWebhook(webhook string) error {
	return wecom.TestWebhook(webhook)
}

// ghosttyOpenURL 拼出 Ghostty 认的地址。空格必须写成 %20。
// Go 的 QueryEscape 会把空格写成 +，Ghostty 会把加号留在主机名里。
// 带 reuse=1：已经打开的主机只聚焦，不再多开一个会话；多台一起打开时并成一个工作区。
func ghosttyOpenURL(hosts []string) (string, error) {
	parts := make([]string, 0, len(hosts))
	for _, host := range hosts {
		alias := strings.TrimSpace(host)
		if alias == "" || strings.ContainsAny(alias, "\r\n") {
			continue
		}
		escaped := strings.ReplaceAll(url.QueryEscape(alias), "+", "%20")
		parts = append(parts, "host="+escaped)
	}
	if len(parts) == 0 {
		return "", fmt.Errorf("没有主机")
	}
	parts = append(parts, "reuse=1")
	return "ghostty://open?" + strings.Join(parts, "&"), nil
}

// OpenHostsInTerminal 把 SSH Host 别名交给终端应用打开会话。
// macOS 走 Ghostty（ghostty://open?host=…）；Windows 走 Windows Terminal + 系统
// OpenSSH，见 terminal_windows.go；Linux 走系统默认终端 + 系统 ssh，见
// terminal_linux.go（mode: "tab"=最近窗口新标签页（默认），"window"=新窗口）。
func (s *System) OpenHostsInTerminal(hosts []string, mode string) error {
	if runtime.GOOS == "windows" {
		return openHostsInTerminalWindows(hosts, mode)
	}
	if runtime.GOOS == "linux" {
		return openHostsInTerminalLinux(hosts, mode)
	}
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("仅支持在 macOS / Windows / Linux 上打开终端")
	}
	target, err := ghosttyOpenURL(hosts)
	if err != nil {
		return err
	}
	cmd := exec.Command("open", target)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return fmt.Errorf("无法打开 Ghostty: %w", err)
		}
		return fmt.Errorf("无法打开 Ghostty: %s", msg)
	}
	return nil
}

// CheckMenuPage 立即用 Go HTTP 检查菜单项（不打开浏览器）。id 空则检查全部，返回最后一项结果以兼容旧调用。
func (s *System) CheckMenuPage(id string) MenuCheckResult {
	(*App)(s).startMenuCheckWatcher()
	if s.menuCheck == nil {
		return MenuCheckResult{Message: "菜单检查未启动"}
	}
	snaps := s.menuCheck.CheckNow(id)
	if len(snaps) == 0 {
		return MenuCheckResult{Message: "未找到检查项"}
	}
	return menuSnapToResult(snaps[len(snaps)-1])
}

// ListMenuChecks 返回内置菜单检查项及最近一次结果。
func (s *System) ListMenuChecks() []MenuCheckResult {
	(*App)(s).startMenuCheckWatcher()
	if s.menuCheck == nil {
		return nil
	}
	snaps := s.menuCheck.Latest()
	out := make([]MenuCheckResult, 0, len(snaps))
	for _, sn := range snaps {
		out = append(out, menuSnapToResult(sn))
	}
	return out
}

func menuSnapToResult(sn menucheck.Snapshot) MenuCheckResult {
	return MenuCheckResult{
		ID:        sn.ID,
		Label:     sn.Label,
		URL:       sn.URL,
		OK:        sn.OK,
		HasData:   sn.HasData,
		MenuText:  sn.MenuText,
		DataText:  sn.DataText,
		Title:     sn.Title,
		Message:   sn.Message,
		CheckedAt: sn.CheckedAt,
		Scheduled: sn.Scheduled,
	}
}
