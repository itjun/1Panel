package main

import (
	_ "embed"
	"runtime"
	"sync"
	"sync/atomic"
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

// quitPrompting 防止 ⌘Q 与前端快捷键同时触发时叠两个确认框。
var quitPrompting atomic.Bool

// shouldQuit 拦截 ⌘Q / 应用菜单「退出」/ Application.Quit：
// 默认先确认「挂后台 / 彻底退出」（可关）；托盘或设置真正退出时 allowQuit=true。
func (a *App) shouldQuit() bool {
	return a.decideQuitIntercept()
}

// decideQuitIntercept 统一处理「想退出」：返回 true 表示允许进程终止。
func (a *App) decideQuitIntercept() bool {
	if a.allowQuit.Load() {
		return true
	}
	if !loadAskBeforeQuit() {
		a.hideToBackground()
		return false
	}
	if !quitPrompting.CompareAndSwap(false, true) {
		return false
	}
	defer quitPrompting.Store(false)

	action, askAgain := a.showQuitConfirmDialog()
	if askAgain != loadAskBeforeQuit() {
		saveAskBeforeQuit(askAgain)
		if a.app != nil {
			a.app.Event.Emit("ask-before-quit-changed", askAgain)
		}
	}
	switch action {
	case macui.QuitConfirmQuit:
		a.allowQuit.Store(true)
		return true
	case macui.QuitConfirmBackground:
		a.hideToBackground()
		return false
	default:
		return false
	}
}

// requestQuitFromFrontend 处理前端 Ctrl/⌘+Q：走同一套确认；若选退出则真正 Quit。
func (a *App) requestQuitFromFrontend() {
	if a.decideQuitIntercept() {
		a.quitForReal()
	}
}

func (a *App) showQuitConfirmDialog() (macui.QuitConfirmAction, bool) {
	ask := loadAskBeforeQuit()
	shortcutLabel := "按 Ctrl+Q 退出前先询问"
	if runtime.GOOS == "darwin" {
		shortcutLabel = "按 ⌘Q 退出前先询问"
	}
	if action, askAgain, ok := macui.ShowQuitConfirm(ask, shortcutLabel); ok {
		return action, askAgain
	}
	return a.showQuitConfirmWails(ask)
}

// showQuitConfirmWails 非 macOS：三按钮问题框（无抑制勾选，开关在设置页）。
func (a *App) showQuitConfirmWails(askAgain bool) (macui.QuitConfirmAction, bool) {
	action := macui.QuitConfirmCancel
	if a.app == nil {
		return action, askAgain
	}
	dialog := a.app.Dialog.Question().
		SetTitle("退出 1Panel？").
		SetMessage("要退出 1Panel 还是挂到后台运行？\n挂到后台后，告警与企微仍会送达。")
	quitBtn := dialog.AddButton("退出 1Panel").OnClick(func() {
		action = macui.QuitConfirmQuit
	})
	dialog.AddButton("挂到后台运行").OnClick(func() {
		action = macui.QuitConfirmBackground
	})
	cancelBtn := dialog.AddButton("取消")
	dialog.SetDefaultButton(quitBtn)
	dialog.SetCancelButton(cancelBtn)
	if a.mainWindow != nil {
		dialog.AttachToWindow(a.mainWindow)
	}
	dialog.Show()
	return action, askAgain
}

// hideToBackground 隐藏主窗，不销毁 WebView，前端轮询与看板 HTTP 继续跑。
// macOS：切到 Accessory，Dock / Cmd-Tab 不显示，菜单栏 extra 保留。
// Windows：从任务栏拿掉，只留右下角托盘；右键「退出应用」才真正退出。
func (a *App) hideToBackground() {
	if a.mainWindow != nil {
		a.mainWindow.Hide()
		winui.SetHiddenOnTaskbar(a.mainWindow, true)
	}
	macui.SetDockIconVisible(false)
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
	tray.SetTooltip("1Panel")

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
