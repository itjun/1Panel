package main

// TerminalSvc 终端服务（PTY 会话）
type TerminalSvc App

// ============ 终端（PTY 会话） ============

// OpenTerminal 打开一个终端会话（Events 模式，作为 WS 通道不可用时的回退）
// eventName 是前端订阅输出的 Wails 事件名
// cols/rows 为 xterm fit 后的真实行列，开 PTY 时就用正确尺寸，避免开局乱码
func (s *TerminalSvc) OpenTerminal(host string, eventName string, cols int, rows int) (string, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return s.termMgr.Open(host, opt, eventName, cols, rows)
}

// TermWSInfo OpenTerminalWS 的返回值：前端用 URL 建立 WebSocket 数据通道
type TermWSInfo struct {
	SessionID string `json:"sessionId"`
	URL       string `json:"url"`
}

// OpenTerminalWS 打开一个 WS 模式终端会话（低延迟数据通道）
// 输入输出走 localhost WebSocket 二进制帧；Resize / Close 频率低，仍走绑定方法
func (s *TerminalSvc) OpenTerminalWS(host string, cols int, rows int) (TermWSInfo, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return TermWSInfo{}, err
	}
	id, url, err := s.termMgr.OpenWS(host, opt, cols, rows)
	if err != nil {
		return TermWSInfo{}, err
	}
	return TermWSInfo{SessionID: id, URL: url}, nil
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
