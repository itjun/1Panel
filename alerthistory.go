package main

import (
	"fmt"
	"strings"

	"diteng-pannel/internal/alerthistory"
)

// AlertHistory 应用内告警历史服务（本地落盘）。
type AlertHistory App

// List 返回最近 limit 条（新→旧）；limit≤0 表示全部。
func (s *AlertHistory) List(limit int) []alerthistory.Event {
	if s.alertHistory == nil {
		return []alerthistory.Event{}
	}
	return s.alertHistory.List(limit)
}

// ListByHost 返回指定主机最近 limit 条；limit≤0 表示该主机全部。
func (s *AlertHistory) ListByHost(host string, limit int) []alerthistory.Event {
	if s.alertHistory == nil {
		return []alerthistory.Event{}
	}
	return s.alertHistory.ListByHost(host, limit)
}

// Append 追加一条告警历史，返回带 id / at 的完整事件。
func (s *AlertHistory) Append(event alerthistory.Event) (alerthistory.Event, error) {
	if s.alertHistory == nil {
		return alerthistory.Event{}, fmt.Errorf("告警历史未初始化")
	}
	return s.alertHistory.Append(event)
}

// MarkRead 将指定事件标为已读。
func (s *AlertHistory) MarkRead(id string) error {
	if s.alertHistory == nil {
		return fmt.Errorf("告警历史未初始化")
	}
	return s.alertHistory.MarkRead(id)
}

// MarkAllRead 全部已读；host 非空则只标该主机。
func (s *AlertHistory) MarkAllRead(host string) error {
	if s.alertHistory == nil {
		return fmt.Errorf("告警历史未初始化")
	}
	return s.alertHistory.MarkAllRead(strings.TrimSpace(host))
}

// Clear 清空全部告警历史。
func (s *AlertHistory) Clear() error {
	if s.alertHistory == nil {
		return fmt.Errorf("告警历史未初始化")
	}
	return s.alertHistory.Clear()
}

// UnreadCount 未读告警条数。
func (s *AlertHistory) UnreadCount() int {
	if s.alertHistory == nil {
		return 0
	}
	return s.alertHistory.UnreadCount()
}
