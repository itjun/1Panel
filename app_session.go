package main

import (
	"fmt"
	"time"

	"diteng-pannel/internal/appsession"
)

const appSessionHeartbeat = 60 * time.Second

// AppSession 应用启动 / 退出运行日志服务（本地落盘）。
type AppSession App

// List 返回最近 limit 条会话（新→旧）；limit≤0 表示全部。
func (s *AppSession) List(limit int) []appsession.Session {
	if s.appSessions == nil {
		return []appsession.Session{}
	}
	return s.appSessions.List(limit)
}

// Current 返回当前运行中的会话；未记录时返回零值。
func (s *AppSession) Current() appsession.Session {
	if s.appSessions == nil {
		return appsession.Session{}
	}
	sess, _ := s.appSessions.Current()
	return sess
}

// Clear 清空历史会话（保留当前会话）。
func (s *AppSession) Clear() error {
	if s.appSessions == nil {
		return fmt.Errorf("运行日志未初始化")
	}
	return s.appSessions.Clear()
}

func (a *App) startAppSession() {
	store, err := appsession.NewStore("ServerPanel")
	if err != nil {
		a.app.Logger.Error("初始化运行日志存储失败", "error", err)
		return
	}
	if _, err := store.Begin(resolveAppVersion()); err != nil {
		a.app.Logger.Warn("记录应用启动失败", "error", err)
	}
	a.appSessions = store
	a.appSessionStop = make(chan struct{})
	go func(stop <-chan struct{}) {
		t := time.NewTicker(appSessionHeartbeat)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				_ = store.Heartbeat()
			}
		}
	}(a.appSessionStop)
}

func (a *App) endAppSession() {
	a.appSessionOnce.Do(func() {
		if a.appSessionStop != nil {
			close(a.appSessionStop)
		}
		if a.appSessions != nil {
			_ = a.appSessions.End()
		}
	})
}
