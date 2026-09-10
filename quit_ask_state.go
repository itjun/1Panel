package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
)

// askBeforeQuit 镜像：⌘Q / 应用菜单「退出」是否先弹出确认。
// 权威值在磁盘；内存原子量供 shouldQuit 同步读取，避免每次弹窗前读文件。
var askBeforeQuit atomic.Bool

type quitAskState struct {
	AskBeforeQuit bool `json:"askBeforeQuit"`
}

func quitAskStatePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "ServerPanel", "quit_ask.json")
}

func initAskBeforeQuit() {
	// 默认开启（与 Firefox「退出前询问」一致）；文件损坏/缺失也按开。
	askBeforeQuit.Store(true)
	p := quitAskStatePath()
	if p == "" {
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var st quitAskState
	if json.Unmarshal(b, &st) != nil {
		return
	}
	askBeforeQuit.Store(st.AskBeforeQuit)
}

func loadAskBeforeQuit() bool {
	return askBeforeQuit.Load()
}

func saveAskBeforeQuit(ask bool) {
	askBeforeQuit.Store(ask)
	p := quitAskStatePath()
	if p == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0755)
	b, err := json.Marshal(quitAskState{AskBeforeQuit: ask})
	if err != nil {
		return
	}
	_ = os.WriteFile(p, b, 0644)
}
