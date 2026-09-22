package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const (
	windowMinW = 1100
	windowMinH = 700
)

type windowGeom struct {
	// 保留旧版顶层字段，兼容原来的 window.json。
	Width     int                      `json:"width"`
	Height    int                      `json:"height"`
	Main      *windowBounds            `json:"main,omitempty"`
	Terminal  *windowBounds            `json:"terminal,omitempty"`
	Terminals map[string]*windowBounds `json:"terminals,omitempty"`
}

type windowBounds struct {
	Width       int  `json:"width"`
	Height      int  `json:"height"`
	X           int  `json:"x,omitempty"`
	Y           int  `json:"y,omitempty"`
	PositionSet bool `json:"positionSet,omitempty"`
}

var windowGeomMu sync.Mutex

func windowGeomPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "ServerPanel", "window.json")
}

func loadWindowGeom() (int, int, bool) {
	b, ok := loadMainWindowBounds()
	if !ok {
		return 0, 0, false
	}
	return b.Width, b.Height, true
}

func saveWindowGeom(w, h int) {
	saveMainWindowBounds(windowBounds{Width: w, Height: h})
}

func loadMainWindowBounds() (windowBounds, bool) {
	windowGeomMu.Lock()
	defer windowGeomMu.Unlock()
	g, ok := readWindowGeomLocked()
	if !ok {
		return windowBounds{}, false
	}
	if g.Main != nil && validWindowBounds(*g.Main) {
		return *g.Main, true
	}
	legacy := windowBounds{Width: g.Width, Height: g.Height}
	if !validWindowBounds(legacy) {
		return windowBounds{}, false
	}
	return legacy, true
}

func loadTerminalWindowBounds(windowID string) (windowBounds, bool) {
	windowGeomMu.Lock()
	defer windowGeomMu.Unlock()
	g, ok := readWindowGeomLocked()
	if !ok {
		return windowBounds{}, false
	}
	if windowID != "" && g.Terminals != nil {
		if bounds := g.Terminals[windowID]; bounds != nil && validWindowBounds(*bounds) {
			return *bounds, true
		}
	}
	// 旧版本只有一个 terminal 字段；第一次创建 terminal-1 时继续复用它。
	if (windowID == "" || windowID == "terminal-1") && g.Terminal != nil && validWindowBounds(*g.Terminal) {
		return *g.Terminal, true
	}
	return windowBounds{}, false
}

func saveMainWindowBounds(bounds windowBounds) {
	if !validWindowBounds(bounds) {
		return
	}
	windowGeomMu.Lock()
	defer windowGeomMu.Unlock()
	g, _ := readWindowGeomLocked()
	g.Width = bounds.Width
	g.Height = bounds.Height
	g.Main = &bounds
	writeWindowGeomLocked(g)
}

func saveTerminalWindowBounds(windowID string, bounds windowBounds) {
	if !validWindowBounds(bounds) {
		return
	}
	windowGeomMu.Lock()
	defer windowGeomMu.Unlock()
	g, _ := readWindowGeomLocked()
	if windowID == "" {
		windowID = "terminal-1"
	}
	if g.Terminals == nil {
		g.Terminals = make(map[string]*windowBounds)
	}
	b := bounds
	g.Terminals[windowID] = &b
	// 继续写入旧字段，兼容尚未迁移的版本和 terminal-1 的旧布局。
	if windowID == "terminal-1" {
		g.Terminal = &b
	}
	writeWindowGeomLocked(g)
}

func validWindowBounds(bounds windowBounds) bool {
	return bounds.Width >= windowMinW && bounds.Height >= windowMinH
}

func readWindowGeomLocked() (windowGeom, bool) {
	p := windowGeomPath()
	if p == "" {
		return windowGeom{}, false
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return windowGeom{}, false
	}
	var g windowGeom
	if json.Unmarshal(b, &g) != nil {
		return windowGeom{}, false
	}
	return g, true
}

func writeWindowGeomLocked(g windowGeom) {
	p := windowGeomPath()
	if p == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0755)
	b, err := json.Marshal(g)
	if err != nil {
		return
	}
	_ = os.WriteFile(p, b, 0644)
}
