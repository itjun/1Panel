package main

import (
	_ "embed"
	"runtime"
	"sync"
	"time"

	"diteng-pannel/internal/macui"
	"diteng-pannel/internal/winui"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

var alertKeepaliveOnce sync.Once

//go:embed build/appicon.png
var appIconPNG []byte

// 菜单栏 extra：透明底 + 黑色字形。macOS 以 template 渲染，随菜单栏/Liquid Glass 着色。
// 规格：22pt 槽、约 16–18pt 光学尺寸（见 Apple HIG Menu bar extras）。
//
//go:embed build/darwin/systray-template.png
var systrayTemplatePNG []byte

//go:embed build/windows/systray.png
var systrayColorPNG []byte

const alertPollTickInterval = 5 * time.Second

// shouldQuit 拦截 ⌘Q / 应用菜单「退出」/ Application.Quit：
// 默认挂到后台继续监听告警；托盘「退出应用」或设置里真正退出时 allowQuit=true。
func (a *App) shouldQuit() bool {
	if a.allowQuit.Load() {
		return true
	}
	a.hideToBackground()
	return false
}

// hideToBackground 隐藏主窗与看板，不销毁 WebView，前端轮询继续跑。
// macOS：切到 Accessory，Dock / Cmd-Tab 不显示，菜单栏 extra 保留。
// Windows：从任务栏拿掉，只留右下角托盘；右键「退出应用」才真正退出。
func (a *App) hideToBackground() {
	wins := a.allWindows()
	for _, w := range wins {
		w.Hide()
		winui.SetHiddenOnTaskbar(w, true)
	}
	macui.SetDockIconVisible(false)
}

func (a *App) allWindows() []*application.WebviewWindow {
	n := 0
	if a.mainWindow != nil {
		n++
	}
	a.boardMu.Lock()
	boards := make([]*application.WebviewWindow, 0, len(a.boardWindows))
	for _, w := range a.boardWindows {
		if w != nil {
			boards = append(boards, w)
		}
	}
	a.boardMu.Unlock()
	out := make([]*application.WebviewWindow, 0, n+len(boards))
	if a.mainWindow != nil {
		out = append(out, a.mainWindow)
	}
	return append(out, boards...)
}

func (a *App) quitForReal() {
	a.allowQuit.Store(true)
	if a.app != nil {
		a.app.Quit()
	}
}

func (a *App) interceptMainWindowClose(win *application.WebviewWindow) {
	if win == nil {
		return
	}
	// RegisterHook 先于默认 WindowClosing 监听（那会真正关掉窗口）。
	// Hide+Cancel 后 WebView 仍在，告警轮询 / 系统通知 / 企微不受影响。
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		a.hideToBackground()
		e.Cancel()
	})
}

func (a *App) installBackgroundTray(app *application.App) {
	if app == nil {
		return
	}
	tray := app.SystemTray.New()
	tray.SetIconPosition(application.NSImageOnly)
	if runtime.GOOS == "darwin" {
		// template：透明底 + 黑色字形，菜单栏按系统色着色，不要应用图标那块白底。
		tray.SetTemplateIcon(systrayTemplatePNG)
	} else {
		tray.SetIcon(systrayColorPNG)
	}
	tray.SetTooltip("1Pannel")

	menu := app.Menu.New()
	menu.Add("显示主窗口").OnClick(func(*application.Context) {
		(*System)(a).FocusMainWindow()
	})
	menu.AddSeparator()
	menu.Add("退出应用").OnClick(func(*application.Context) {
		a.quitForReal()
	})
	tray.SetMenu(menu)
	showMain := func() {
		(*System)(a).FocusMainWindow()
	}
	// Windows 托盘原生有 WM_LBUTTONDBLCLK；macOS 状态栏只有单击，自己认第二下。
	tray.OnDoubleClick(showMain)
	if runtime.GOOS == "darwin" {
		var lastClick time.Time
		tray.OnClick(func() {
			now := time.Now()
			if !lastClick.IsZero() && now.Sub(lastClick) < 500*time.Millisecond {
				lastClick = time.Time{}
				showMain()
				return
			}
			lastClick = now
		})
	}
	tray.OnRightClick(func() {
		tray.OpenMenu()
	})
}

// startAlertPollKeepalive 定时唤醒前端告警轮询。
// 窗口隐藏后部分 WebView 会节流 setInterval，这条事件补一拍。
func (a *App) startAlertPollKeepalive() {
	alertKeepaliveOnce.Do(func() {
		go func() {
			t := time.NewTicker(alertPollTickInterval)
			defer t.Stop()
			for range t.C {
				app := a.app
				if app == nil {
					continue
				}
				app.Event.Emit("alert-poll-tick", nil)
			}
		}()
	})
}
