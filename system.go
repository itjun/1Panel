package main

import (
	"fmt"
	"net/url"
	"runtime"
	"strings"
	"time"

	"diteng-pannel/internal/desktop"
	"diteng-pannel/internal/macui"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/wecom"

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
		macui.InstallCenteredTrafficLights(w, macTitleBarHeight)
	}
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
		BackgroundColour:           application.NewRGB(15, 17, 21), // #0f1115
		Hidden:                     false,
		DefaultContextMenuDisabled: true,
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBarHidden,
			InvisibleTitleBarHeight: macTitleBarHeight,
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
func (s *System) FocusMainWindow() {
	w := s.mainWindow
	if w == nil {
		return
	}
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

// NotifyHostAlert 面板检测到 CPU/内存/磁盘/负载超阈值或回落时发企微。
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
	label := resourceAlertLabel(kind)
	n := wecom.WatchNotify{
		Host:     host,
		Kind:     kind,
		Detail:   strings.TrimSpace(in.Detail),
		NotifyAt: time.Now(),
		Source:   wecom.LocalSource(),
	}
	if strings.TrimSpace(in.State) == "up" {
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

// NotifyDesktop 本机系统通知（macOS 通知中心）。其它平台目前为空操作。
func (s *System) NotifyDesktop(title, body string) error {
	return desktop.Notify(title, body)
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
