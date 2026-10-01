package main

import (
	"strings"
	"sync"

	"diteng-pannel/internal/alerthistory"
	"diteng-pannel/internal/desktop"
	"diteng-pannel/internal/menucheck"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var menuCheckStartOnce sync.Once

// startMenuCheckWatcher 每天 18:00–20:00 每 5 分钟用 Go HTTP 探活菜单页（不打开浏览器）。
// 任一次菜单不可用：写入应用内告警历史 + 本机系统通知（不发企业微信）。
func (a *App) startMenuCheckWatcher() {
	menuCheckStartOnce.Do(func() {
		w := menucheck.NewWatcher(nil, a.onMenuCheckAlert, a.onMenuCheckUpdate)
		a.menuCheck = w
		w.Start()
	})
}

func (a *App) onMenuCheckUpdate(snap menucheck.Snapshot) {
	app := a.app
	if app == nil {
		app = application.Get()
	}
	if app != nil {
		app.Event.Emit("menu-check-updated", snap)
	}
}

func (a *App) onMenuCheckAlert(snap menucheck.Snapshot) {
	msg := strings.TrimSpace(snap.Message)
	if msg == "" {
		msg = snap.MenuText
	}
	if msg == "" {
		msg = "菜单异常"
	}
	title := snap.Label + " · 菜单异常"
	eventID := ""
	if a.alertHistory != nil {
		if saved, err := a.alertHistory.Append(alerthistory.Event{
			Host:     "菜单检查",
			Kind:     "menu:" + snap.ID,
			State:    "down",
			Title:    title,
			Detail:   msg,
			Metric:   snap.Label,
			Value:    msg,
			Channels: []string{"inApp", "system"},
		}); err == nil {
			eventID = saved.ID
		}
	}
	_ = desktop.Notify(desktop.Payload{
		Title:   title,
		Body:    msg,
		Host:    "菜单检查",
		EventID: eventID,
		Kind:    "menu:" + snap.ID,
	})
	if app := a.app; app != nil {
		app.Event.Emit("alert-history-updated", nil)
	}
}
