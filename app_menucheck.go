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

// startMenuCheckWatcher 加载用户配置的巡检项，按各自的间隔与时间窗用 Go HTTP 探活（不打开浏览器）。
// 定时检查每次失败：写入应用内告警历史 + 本机系统通知（不发企业微信）。
func (a *App) startMenuCheckWatcher() {
	menuCheckStartOnce.Do(func() {
		store, err := menucheck.NewStore("ServerPanel")
		if err != nil {
			if app := application.Get(); app != nil {
				app.Logger.Error("初始化巡检配置失败", "error", err)
			}
			return
		}
		w := menucheck.NewWatcher(store, a.onMenuCheckAlert, a.onMenuCheckUpdate)
		a.menuCheckStore = store
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
		app.Event.Emit("menu-check-updated", menuSnapToResult(snap))
	}
}

// onMenuCheckAlert 正文只放判定结果，不带 URL / Header，避免 Token 落进通知与告警历史。
func (a *App) onMenuCheckAlert(snap menucheck.Snapshot) {
	msg := strings.TrimSpace(snap.Message)
	if msg == "" {
		msg = "巡检失败"
	}
	label := snap.Label
	if label == "" {
		label = "巡检"
	}
	title := label + " · 巡检失败"
	kind := "inspect:" + snap.ID
	eventID := ""
	if a.alertHistory != nil {
		if saved, err := a.alertHistory.Append(alerthistory.Event{
			Host:     "巡检",
			Kind:     kind,
			State:    "down",
			Title:    title,
			Detail:   msg,
			Metric:   label,
			Value:    msg,
			Channels: []string{"inApp", "system"},
		}); err == nil {
			eventID = saved.ID
		}
	}
	_ = desktop.Notify(desktop.Payload{
		Title:   title,
		Body:    msg,
		Host:    "巡检",
		EventID: eventID,
		Kind:    kind,
	})
	if app := a.app; app != nil {
		app.Event.Emit("alert-history-updated", nil)
	}
}
