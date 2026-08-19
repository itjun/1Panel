package main

import (
	"diteng-pannel/internal/monitor"

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
}

// GetMyEgress 查询本机出口公网 IP 与归属地（来自 myip.ipip.net）
// 用于侧栏底部显示。不依赖任何主机。
func (s *System) GetMyEgress() (monitor.EgressInfo, error) {
	return monitor.FetchEgress()
}
