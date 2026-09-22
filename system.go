package main

import (
	"fmt"
	"net/url"
	"runtime"
	"slices"
	"strings"
	"time"

	"diteng-pannel/internal/desktop"
	"diteng-pannel/internal/macui"
	"diteng-pannel/internal/menucheck"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/wecom"
	"diteng-pannel/internal/winui"

	"github.com/google/uuid"
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
	terminalWindowW = 1280
	terminalWindowH = 800
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

// TerminalWindowCommand 是窗口间的终端动作。WindowID 为空时创建新的终端原生窗口，
// 非空时把动作投递给已有目标窗口。
type TerminalWindowCommand struct {
	Action       string   `json:"action,omitempty"`
	WindowID     string   `json:"windowId,omitempty"`
	Created      bool     `json:"created,omitempty"`
	Host         string   `json:"host,omitempty"`
	Hosts        []string `json:"hosts,omitempty"`
	TransferID   string   `json:"transferId,omitempty"`
	TargetDeskID string   `json:"targetDeskId,omitempty"`
	InsertBefore bool     `json:"insertBefore,omitempty"`
}

type TerminalWindowInfo struct {
	WindowID string `json:"windowId"`
	Visible  bool   `json:"visible"`
}

const terminalWindowNamePrefix = "terminal-"

// TerminalTransfer 是跨 WebView 移动终端时的短暂交接数据。
// SessionID 保留后端的原 SSH/PTY；Snapshot 只用于恢复 xterm 的画面和滚动历史。
type TerminalTransfer struct {
	TransferID  string `json:"transferId,omitempty"`
	SessionID   string `json:"sessionId"`
	Host        string `json:"host"`
	PaneID      string `json:"paneId"`
	Title       string `json:"title,omitempty"`
	TitleCustom bool   `json:"titleCustom,omitempty"`
	Snapshot    string `json:"snapshot"`
	Cols        int    `json:"cols"`
	Rows        int    `json:"rows"`
}

type terminalTransferState struct {
	payload TerminalTransfer
	claimed bool
	timer   *time.Timer
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

	s.terminalWindowMu.Lock()
	terminals := make([]*application.WebviewWindow, 0, len(s.terminalWindows))
	for _, terminal := range s.terminalWindows {
		if terminal != nil {
			terminals = append(terminals, terminal)
		}
	}
	s.terminalWindowMu.Unlock()
	for _, terminal := range terminals {
		s.applyAppearanceOnWindow(terminal)
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

// OpenTerminalWindow 仅由用户明确选择新窗口或拖拽终端时调用。
// WindowID 为空时创建新的终端窗；指定 WindowID 时复用已有窗口，把动作投递过去。
func (s *System) OpenTerminalWindow(command TerminalWindowCommand) error {
	command = normalizeTerminalWindowCommand(command)
	if s.app == nil {
		return fmt.Errorf("应用未就绪")
	}
	if command.WindowID == "main" {
		// 主窗口不是 terminalWindows 的成员，但它也可以作为跨窗口拖拽的目标。
		// 直接把交接动作广播给主 WebView，由主窗口领取 transfer。
		s.app.Event.Emit("terminal-window-command", command)
		return nil
	}

	s.terminalWindowMu.Lock()
	windowID := command.WindowID
	win := s.terminalWindows[windowID]
	created := false
	restorePosition := false
	restoreX, restoreY := 0, 0
	if win == nil {
		if windowID == "" {
			for {
				s.terminalWindowSeq++
				windowID = fmt.Sprintf("%s%d", terminalWindowNamePrefix, s.terminalWindowSeq)
				if s.terminalWindows[windowID] == nil {
					if _, exists := s.app.Window.GetByName(windowID); !exists {
						break
					}
				}
			}
		} else if existing, ok := s.app.Window.GetByName(windowID); ok {
			if tw, ok := existing.(*application.WebviewWindow); ok {
				win = tw
				s.terminalWindows[windowID] = win
				if _, known := s.terminalWindowReady[windowID]; !known {
					s.terminalWindowReady[windowID] = true
				}
			}
		}
	}
	if win == nil {
		width, height := terminalWindowW, terminalWindowH
		bounds, hasBounds := loadTerminalWindowBounds(windowID)
		if hasBounds {
			width, height = bounds.Width, bounds.Height
		}
		opts := application.WebviewWindowOptions{
			Name:                       windowID,
			Title:                      "1Pannel · " + windowID,
			URL:                        "/?mode=terminal&windowId=" + url.QueryEscape(windowID),
			Width:                      width,
			Height:                     height,
			MinWidth:                   windowMinW,
			MinHeight:                  windowMinH,
			InitialPosition:            application.WindowCentered,
			BackgroundColour:           application.NewRGB(14, 14, 14),
			Hidden:                     true,
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
		s.terminalWindows[windowID] = win
		s.terminalWindowReady[windowID] = false
		s.terminalWindowVisible[windowID] = true
		created = true

		terminalBoundsOK := hasBounds && bounds.PositionSet
		if terminalBoundsOK {
			restorePosition = true
			restoreX, restoreY = bounds.X, bounds.Y
		}
		win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
			s.terminalWindowMu.Lock()
			s.terminalWindowVisible[windowID] = false
			s.terminalWindowMu.Unlock()
			(*App)(s).saveTerminalWindowGeom(windowID)
			win.Hide()
			e.Cancel()
		})
		win.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
			(*App)(s).scheduleSaveTerminalGeomFor(windowID)
		})
		win.OnWindowEvent(events.Common.WindowDidMove, func(*application.WindowEvent) {
			(*App)(s).scheduleSaveTerminalGeomFor(windowID)
		})
		win.SetBackgroundColour(application.NewRGB(14, 14, 14))
		s.applyAppearanceOnWindow(win)
	}
	command.WindowID = windowID
	command.Created = created
	s.terminalWindowVisible[windowID] = true
	if command.Action != "" && !s.terminalWindowReady[windowID] {
		s.pendingTerminalEvents[windowID] = append(s.pendingTerminalEvents[windowID], command)
	}
	ready := s.terminalWindowReady[windowID]
	s.terminalWindowMu.Unlock()

	if restorePosition {
		win.SetPosition(restoreX, restoreY)
	}
	if created {
		win.Show()
		win.Focus()
	} else if win != nil {
		win.Show()
		win.Focus()
	}
	if command.Action != "" && ready {
		s.app.Event.Emit("terminal-window-command", command)
	}
	return nil
}

// ListTerminalWindows 返回当前进程内创建过的终端原生窗口。
// 窗口关闭时只是隐藏，因此前端可以用它提供「恢复窗口」入口。
func (s *System) ListTerminalWindows() []TerminalWindowInfo {
	s.terminalWindowMu.Lock()
	defer s.terminalWindowMu.Unlock()
	items := make([]TerminalWindowInfo, 0, len(s.terminalWindows))
	for id := range s.terminalWindows {
		items = append(items, TerminalWindowInfo{
			WindowID: id,
			Visible:  s.terminalWindowVisible[id],
		})
	}
	slices.SortFunc(items, func(a, b TerminalWindowInfo) int {
		return strings.Compare(a.WindowID, b.WindowID)
	})
	return items
}

// FocusTerminalWindow 恢复一个被隐藏的终端窗口，不创建新会话或新窗口。
func (s *System) FocusTerminalWindow(windowID string) error {
	windowID = strings.TrimSpace(windowID)
	if windowID == "" {
		return fmt.Errorf("windowID 不能为空")
	}
	s.terminalWindowMu.Lock()
	win := s.terminalWindows[windowID]
	if win != nil {
		s.terminalWindowVisible[windowID] = true
	}
	s.terminalWindowMu.Unlock()
	if win == nil {
		return fmt.Errorf("终端窗口不存在: %s", windowID)
	}
	win.Show()
	win.Focus()
	return nil
}

// HideTerminalWindow 隐藏指定终端窗，但不销毁 WebView 或终端会话。
func (s *System) HideTerminalWindow(windowID string) error {
	windowID = strings.TrimSpace(windowID)
	if windowID == "" {
		return fmt.Errorf("windowID 不能为空")
	}
	s.terminalWindowMu.Lock()
	win := s.terminalWindows[windowID]
	if win != nil {
		s.terminalWindowVisible[windowID] = false
	}
	s.terminalWindowMu.Unlock()
	if win == nil {
		return fmt.Errorf("终端窗口不存在: %s", windowID)
	}
	(*App)(s).saveTerminalWindowGeom(windowID)
	win.Hide()
	return nil
}

// TerminalWindowReady 标记某个终端 WebView 已挂载，并领取创建期间暂存的动作。
func (s *System) TerminalWindowReady(windowID string) []TerminalWindowCommand {
	windowID = strings.TrimSpace(windowID)
	if windowID == "" {
		return nil
	}
	s.terminalWindowMu.Lock()
	s.terminalWindowReady[windowID] = true
	commands := append([]TerminalWindowCommand(nil), s.pendingTerminalEvents[windowID]...)
	delete(s.pendingTerminalEvents, windowID)
	s.terminalWindowMu.Unlock()
	return commands
}

// BeginTerminalTransfer 暂停指定 PTY 的流输出并保存短暂的跨 WebView 交接数据。
// 在目标 WebView 完成接管前，输出只进入该 sid 的隔离缓冲，不会落到旧窗或丢弃。
func (s *System) BeginTerminalTransfer(payload TerminalTransfer) (string, error) {
	payload.SessionID = strings.TrimSpace(payload.SessionID)
	payload.Host = strings.TrimSpace(payload.Host)
	payload.PaneID = strings.TrimSpace(payload.PaneID)
	if payload.SessionID == "" || payload.Host == "" || payload.PaneID == "" {
		return "", fmt.Errorf("终端交接数据不完整")
	}
	if s.termStream == nil {
		return "", fmt.Errorf("终端流服务未就绪，暂不能移动会话")
	}
	if err := s.termStream.hold(payload.SessionID); err != nil {
		return "", err
	}
	id := uuid.NewString()
	payload.TransferID = id
	entry := &terminalTransferState{payload: payload}
	entry.timer = time.AfterFunc(30*time.Second, func() {
		_ = (*System)(s).CancelTerminalTransfer(id)
	})
	s.terminalTransferMu.Lock()
	s.terminalTransfers[id] = entry
	s.terminalTransferMu.Unlock()
	return id, nil
}

// TakeTerminalTransfer 由目标 WebView领取交接数据；领取本身不会释放输出缓冲。
func (s *System) TakeTerminalTransfer(id string) (TerminalTransfer, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return TerminalTransfer{}, fmt.Errorf("交接 ID 不能为空")
	}
	s.terminalTransferMu.Lock()
	entry := s.terminalTransfers[id]
	if entry == nil {
		s.terminalTransferMu.Unlock()
		return TerminalTransfer{}, fmt.Errorf("终端交接已过期")
	}
	if entry.claimed {
		s.terminalTransferMu.Unlock()
		return TerminalTransfer{}, fmt.Errorf("终端交接已被领取")
	}
	entry.claimed = true
	payload := entry.payload
	s.terminalTransferMu.Unlock()
	return payload, nil
}

// CompleteTerminalTransfer 目标 WebView 已挂载 xterm 和流通道后提交交接。
func (s *System) CompleteTerminalTransfer(id string) error {
	id = strings.TrimSpace(id)
	s.terminalTransferMu.Lock()
	entry := s.terminalTransfers[id]
	if entry == nil {
		s.terminalTransferMu.Unlock()
		return fmt.Errorf("终端交接已过期")
	}
	delete(s.terminalTransfers, id)
	if entry.timer != nil {
		entry.timer.Stop()
	}
	s.terminalTransferMu.Unlock()
	if s.termStream == nil {
		return nil
	}
	return s.termStream.release(entry.payload.SessionID)
}

// CancelTerminalTransfer 交接失败或超时，恢复原 sid 的输出流。
func (s *System) CancelTerminalTransfer(id string) error {
	id = strings.TrimSpace(id)
	s.terminalTransferMu.Lock()
	entry := s.terminalTransfers[id]
	if entry == nil {
		s.terminalTransferMu.Unlock()
		return nil
	}
	delete(s.terminalTransfers, id)
	if entry.timer != nil {
		entry.timer.Stop()
	}
	s.terminalTransferMu.Unlock()
	if s.termStream == nil {
		return nil
	}
	return s.termStream.release(entry.payload.SessionID)
}

func (a *App) cancelAllTerminalTransfers() {
	a.terminalTransferMu.Lock()
	entries := make([]*terminalTransferState, 0, len(a.terminalTransfers))
	for id, entry := range a.terminalTransfers {
		delete(a.terminalTransfers, id)
		if entry.timer != nil {
			entry.timer.Stop()
		}
		entries = append(entries, entry)
	}
	a.terminalTransferMu.Unlock()
	if a.termStream == nil {
		return
	}
	for _, entry := range entries {
		_ = a.termStream.release(entry.payload.SessionID)
	}
}

func normalizeTerminalWindowCommand(command TerminalWindowCommand) TerminalWindowCommand {
	command.Action = strings.TrimSpace(command.Action)
	command.WindowID = strings.TrimSpace(command.WindowID)
	command.Host = strings.TrimSpace(command.Host)
	command.TransferID = strings.TrimSpace(command.TransferID)
	command.TargetDeskID = strings.TrimSpace(command.TargetDeskID)
	if len(command.Hosts) == 0 {
		command.Hosts = nil
		return command
	}
	seen := make(map[string]struct{}, len(command.Hosts))
	hosts := make([]string, 0, len(command.Hosts))
	for _, host := range command.Hosts {
		name := strings.TrimSpace(host)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		hosts = append(hosts, name)
	}
	command.Hosts = hosts
	return command
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

// NotifyHostAlert 面板检测到 CPU/内存/磁盘/负载超阈值或回落、应用探活异常/恢复、证书到期/续期时发企微。
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
		return wecom.NotifyWecom(webhook, text)
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
