package main

import (
	"fmt"
	"strings"
)

// TerminalSvc 终端服务（PTY 会话）
type TerminalSvc App

// ============ 终端（PTY 会话） ============

// OpenTerminal 打开一个终端会话（独立 SSH 连接 + Wails 事件推送）
// eventName 是前端订阅输出的 Wails 事件名
// cols/rows 为 xterm fit 后的真实行列，开 PTY 时就用正确尺寸，避免开局乱码
func (s *TerminalSvc) OpenTerminal(host string, eventName string, cols int, rows int) (string, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return s.termMgr.Open(host, opt, eventName, cols, rows)
}


func (s *TerminalSvc) WriteTerminal(sessionID string, data string) error {
	return s.termMgr.WriteInput(sessionID, []byte(data))
}

// ResizeTerminal 通知终端会话窗口大小变化（cols/rows）
// 前端 xterm 的 fit.addon 计算出行列数后调用此方法，后端通过 ioctl 同步给 PTY
func (s *TerminalSvc) ResizeTerminal(sessionID string, cols int, rows int) error {
	return s.termMgr.Resize(sessionID, cols, rows)
}

func (s *TerminalSvc) CloseTerminal(sessionID string) error {
	return s.termMgr.Close(sessionID)
}

// TermStreamEndpoint 返回本地终端流服务地址（JSON：base + token）。
// 前端优先用它做终端输入输出（SSE + fetch，绕开 wails 主线程通道），
// 拿不到或连接失败时自动回退 wails 事件/binding 通道。
func (s *TerminalSvc) TermStreamEndpoint() (string, error) {
	if a := (*App)(s); a != nil && a.termStream != nil {
		return a.termStream.endpoint(), nil
	}
	return "", fmt.Errorf("终端流服务未启动")
}

// DisconnectHost 断开主机的全部连接：关闭该主机所有终端会话（独立连接一并释放），
// 再关闭连接池中该主机的连接。前端关闭主机标签时调用。
func (s *TerminalSvc) DisconnectHost(host string) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	s.termMgr.CloseByHost(host)
	if a := (*App)(s); a != nil && a.sshMgr != nil {
		a.sshMgr.Close(host)
	}
	return nil
}
