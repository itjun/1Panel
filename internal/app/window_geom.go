package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	windowMinW = 900
	windowMinH = 700
)

type windowGeom struct {
	// 保留旧版顶层字段，兼容原来的 window.json。
	Width     int                      `json:"width"`
	Height    int                      `json:"height"`
	Main      *windowBounds            `json:"main,omitempty"`
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


func validWindowBounds(bounds windowBounds) bool {
	return bounds.Width >= windowMinW && bounds.Height >= windowMinH
}

func validScreen(screen *application.Screen) bool {
	return screen != nil && screen.Bounds.Width > 0 && screen.Bounds.Height > 0
}

// screenForSavedBounds 以窗口和屏幕的最大重叠面积识别上次所在屏幕。
func screenForSavedBounds(screens []*application.Screen, primary *application.Screen, bounds windowBounds, positionSet bool) *application.Screen {
	var selected *application.Screen
	bestArea := 0
	if positionSet {
		for _, screen := range screens {
			if !validScreen(screen) {
				continue
			}
			r := screen.Bounds
			width := min(bounds.X+bounds.Width, r.X+r.Width) - max(bounds.X, r.X)
			height := min(bounds.Y+bounds.Height, r.Y+r.Height) - max(bounds.Y, r.Y)
			if width > 0 && height > 0 && width*height > bestArea {
				selected = screen
				bestArea = width * height
			}
		}
	}
	if selected != nil {
		return selected
	}
	if validScreen(primary) {
		return primary
	}
	return nil
}

func windowBoundsForScreen(screen *application.Screen) (windowBounds, bool) {
	if !validScreen(screen) {
		return windowBounds{}, false
	}
	r := screen.Bounds
	w := max(windowMinW, r.Width*8/10)
	h := max(windowMinH, r.Height*8/10)
	return windowBounds{Width: w, Height: h, X: r.X + (r.Width-w)/2, Y: r.Y + (r.Height-h)/2, PositionSet: true}, true
}

func (a *App) fitWindowToScreen(screen *application.Screen) bool {
	bounds, ok := windowBoundsForScreen(screen)
	if !ok || a.mainWindow == nil {
		return false
	}
	a.mainWindow.SetSize(bounds.Width, bounds.Height)
	a.mainWindow.SetPosition(bounds.X, bounds.Y)
	return true
}

func (a *App) fitReturningWindow() {
	if a.mainWindow == nil || a.app == nil {
		return
	}
	if a.fitCurrentWindowScreen() {
		return
	}
	// 屏幕信息尚未就绪时保留当前尺寸；用户手动调整后不再覆盖。
	w, h := a.mainWindow.Size()
	x, y := a.mainWindow.Position()
	go func() {
		for i := 0; i < 10; i++ {
			time.Sleep(500 * time.Millisecond)
			if !a.mainWindow.IsVisible() {
				return
			}
			currentW, currentH := a.mainWindow.Size()
			currentX, currentY := a.mainWindow.Position()
			if currentW != w || currentH != h || currentX != x || currentY != y {
				return
			}
			if a.fitCurrentWindowScreen() {
				return
			}
		}
	}()
}

func (a *App) fitCurrentWindowScreen() bool {
	screens := a.app.Screen.GetAll()
	current, _ := a.mainWindow.GetScreen()
	var screen *application.Screen
	if current != nil {
		for _, candidate := range screens {
			if validScreen(candidate) && candidate.ID == current.ID {
				screen = candidate
				break
			}
		}
	}
	if screen == nil {
		screen = a.app.Screen.GetPrimary()
	}
	return a.fitWindowToScreen(screen)
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
