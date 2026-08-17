package main

// ============ 终端（PTY 会话） ============

// OpenTerminal 打开一个终端会话
// eventName 是前端订阅输出的 Wails 事件名
// cols/rows 为 xterm fit 后的真实行列，开 PTY 时就用正确尺寸，避免开局乱码
func (a *App) OpenTerminal(host string, eventName string, cols int, rows int) (string, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return a.termMgr.Open(host, opt, eventName, cols, rows)
}

func (a *App) WriteTerminal(sessionID string, data string) error {
	return a.termMgr.WriteInput(sessionID, []byte(data))
}

// ResizeTerminal 通知终端会话窗口大小变化（cols/rows）
// 前端 xterm 的 fit.addon 计算出行列数后调用此方法，后端通过 ioctl 同步给 PTY
func (a *App) ResizeTerminal(sessionID string, cols int, rows int) error {
	return a.termMgr.Resize(sessionID, cols, rows)
}

func (a *App) CloseTerminal(sessionID string) error {
	return a.termMgr.Close(sessionID)
}
