package main

import (
	"sync"

	"diteng-pannel/internal/alerthistory"
	"diteng-pannel/internal/desktop"
	"diteng-pannel/internal/menucheck"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var menuCheckStartOnce sync.Once

// startMenuCheckWatcher 每天 18:00–20:00 每 5 分钟用 Go HTTP 探活菜单页（不打开浏览器）。
// 任一次访问失败立即写入告警历史并发系统通知。
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
	msg := snap.Message
	if msg == "" {
		msg = "菜单页访问失败"
	}
	title := snap.Label + " 不可访问"
	eventID := ""
	if a.alertHistory != nil {
		if saved, err := a.alertHistory.Append(alerthistory.Event{
			Host:   "菜单检查",
			Kind:   "menu:" + snap.ID,
			State:  "down",
			Title:  title,
			Detail: msg,
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
