package main

import (
	"fmt"
	"net/url"
	"runtime"
	"strings"
	"time"

	"diteng-pannel/internal/desktop"
	"diteng-pannel/internal/macui"
	"diteng-pannel/internal/menucheck"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/wecom"
	"diteng-pannel/internal/winui"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	ungroupedGroupID = "__ungrouped__"
	// 默认约可整齐放下 3×2 / 3×3 主机卡（含顶栏与间距）
	boardWindowW    = 1440
	boardWindowH    = 900
	boardWindowMinW = 1100
	boardWindowMinH = 720
)

// 实色窗底：看板深色
var (
	boardWindowSolidColour = application.NewRGB(15, 17, 21)
)

func boardWindowName(groupID string) string {
	return "board-" + groupID
}

func boardWindowTitle(groupID, groupName string) string {
	name := strings.TrimSpace(groupName)
	if name == "" {
		if groupID == ungroupedGroupID {
			name = "未分组"
		} else {
			name = groupID
		}
	}
	return "看板 · " + name
}

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

// SetThemeAppearance 同步窗口原生外观。应用已固定亮色主题：
// 无论传入什么值（历史前端仍可能传 dark/auto），一律按 light 处理。
func (s *System) SetThemeAppearance(_mode string) {
	s.themeAppearance = macui.AppearanceLight

	s.applyAppearanceOnWindow(s.mainWindow)

	s.boardMu.Lock()
	boards := make([]*application.WebviewWindow, 0, len(s.boardWindows))
	for _, w := range s.boardWindows {
		boards = append(boards, w)
	}
	s.boardMu.Unlock()
	for _, w := range boards {
		s.applyAppearanceOnWindow(w)
	}
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

// OpenBoardWindow 打开或聚焦该分组的看板窗（普通尺寸，不立刻全屏、不调进程级 kiosk）。
// 同分组重复调用只聚焦已有窗；不同分组各自一窗，互不影响。
func (s *System) OpenBoardWindow(groupID string) error {
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return fmt.Errorf("groupID 不能为空")
	}

	groupName := ""
	if groupID == ungroupedGroupID {
		groupName = "未分组"
	} else {
		if s.groups == nil {
			return fmt.Errorf("分组存储未初始化")
		}
		found := false
		for _, g := range s.groups.List() {
			if g.ID == groupID {
				found = true
				groupName = g.Name
				break
			}
		}
		if !found {
			return fmt.Errorf("分组不存在: %s", groupID)
		}
	}
	if s.app == nil {
		return fmt.Errorf("应用未就绪")
	}

	winName := boardWindowName(groupID)
	title := boardWindowTitle(groupID, groupName)

	s.boardMu.Lock()
	defer s.boardMu.Unlock()
	win := s.boardWindows[groupID]
	if win == nil {
		if existing, ok := s.app.Window.GetByName(winName); ok {
			if bw, ok := existing.(*application.WebviewWindow); ok {
				win = bw
				s.boardWindows[groupID] = bw
			}
		}
	}

	if win != nil {
		win.SetTitle(title)
		win.Show()
		win.Focus()
		return nil
	}

	boardURL := "/?mode=board&groupId=" + url.QueryEscape(groupID)
	opts := application.WebviewWindowOptions{
		Name:                       winName,
		Title:                      title,
		URL:                        boardURL,
		Width:                      boardWindowW,
		Height:                     boardWindowH,
		MinWidth:                   boardWindowMinW,
		MinHeight:                  boardWindowMinH,
		InitialPosition:            application.WindowCentered,
		BackgroundColour:           boardWindowSolidColour, // 默认深色实底
		Hidden:                     false,
		DefaultContextMenuDisabled: true,
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBarHidden,
			InvisibleTitleBarHeight: macInvisibleTitleBarHeight,
			Backdrop:                application.MacBackdropNormal,
		},
	}
	if runtime.GOOS != "darwin" {
		opts.Frameless = true
		opts.Windows.DisableMenu = true
		opts.Windows.NonClientRegionSupport = true
	}

	win = s.app.Window.NewWithOptions(opts)
	s.boardWindows[groupID] = win

	win.SetBackgroundColour(boardWindowSolidColour)
	s.applyAppearanceOnWindow(win)

	gid := groupID
	win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		s.boardMu.Lock()
		if s.boardWindows[gid] == win {
			delete(s.boardWindows, gid)
		}
		s.boardMu.Unlock()
	})

	win.Show()
	win.Focus()
	return nil
}

// CloseBoardWindow 按 groupID 关闭对应看板窗；groupID 为空则无操作（须显式传分组）。
func (s *System) CloseBoardWindow(groupID string) {
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return
	}
	s.boardMu.Lock()
	win := s.boardWindows[groupID]
	s.boardMu.Unlock()
	if win != nil {
		win.Close()
	}
}

// FocusMainWindow 显示并聚焦主窗口（看板双击主机后切回主窗操作）。
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

// NotifyHostAlert 面板检测到 CPU/内存/磁盘/负载超阈值或回落、以及应用探活异常/恢复时发企微。
func (s *System) NotifyHostAlert(in HostAlertNotify) error {
	webhook := strings.TrimSpace(in.Webhook)
	if webhook == "" {
		return nil
	}
	host := strings.TrimSpace(in.Host)
	if host == "" {
		return nil
	}
	kind := strings.TrimSpace(in.Kind)
	up := strings.TrimSpace(in.State) == "up"
	n := wecom.WatchNotify{
		Host:     host,
		Kind:     kind,
		Detail:   strings.TrimSpace(in.Detail),
		NotifyAt: time.Now(),
		Source:   wecom.LocalSource(),
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
		return wecom.NotifyWecom(webhook, wecom.FormatWatchMarkdown(n))
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
	return wecom.NotifyWecom(webhook, wecom.FormatWatchMarkdown(n))
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
