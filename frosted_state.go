package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// frostedState 镜像前端 localStorage 的磨砂开关，供启动早期（前端 JS 尚未跑）读取，
// 避免主窗先实色再磨砂的首帧闪烁。权威值仍是前端设置；SetFrostedChrome 时同步写回。
type frostedState struct {
	Enabled bool `json:"enabled"`
}

func frostedStatePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "ServerPanel", "frosted.json")
}

// loadFrostedState 读镜像；不存在/损坏时默认开（与前端 DEFAULTS.frostedChrome 一致）。
func loadFrostedState() bool {
	p := frostedStatePath()
	if p == "" {
		return true
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return true
	}
	var st frostedState
	if json.Unmarshal(b, &st) != nil {
		return true
	}
	return st.Enabled
}

func saveFrostedState(enabled bool) {
	p := frostedStatePath()
	if p == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0755)
	b, err := json.Marshal(frostedState{Enabled: enabled})
	if err != nil {
		return
	}
	_ = os.WriteFile(p, b, 0644)
}
