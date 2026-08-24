package main

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
