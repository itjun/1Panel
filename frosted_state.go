package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
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

// loadFrostedState 读镜像；不存在/损坏时按平台取默认（与前端 DEFAULTS.frostedChrome 一致）：
// macOS 默认开，Windows 等平台无系统磨砂，默认关。
func loadFrostedState() bool {
	def := runtime.GOOS == "darwin"
	p := frostedStatePath()
	if p == "" {
		return def
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return def
	}
	var st frostedState
	if json.Unmarshal(b, &st) != nil {
		return def
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
