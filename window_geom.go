package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const (
	windowMinW = 1100
	windowMinH = 700
)

type windowGeom struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

func windowGeomPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "ServerPanel", "window.json")
}

func loadWindowGeom() (int, int, bool) {
	p := windowGeomPath()
	if p == "" {
		return 0, 0, false
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return 0, 0, false
	}
	var g windowGeom
	if json.Unmarshal(b, &g) != nil {
		return 0, 0, false
	}
	if g.Width < windowMinW || g.Height < windowMinH {
		return 0, 0, false
	}
	return g.Width, g.Height, true
}

func saveWindowGeom(w, h int) {
	if w < windowMinW || h < windowMinH {
		return
	}
	p := windowGeomPath()
	if p == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0755)
	b, err := json.Marshal(windowGeom{Width: w, Height: h})
	if err != nil {
		return
	}
	_ = os.WriteFile(p, b, 0644)
}
