package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/agentinstall"
	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/hosticon"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
	"diteng-pannel/internal/terminal"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// App 是应用核心对象：持有全部共享依赖。
// 对外暴露的前端方法不再直接挂在 App 上，而是按域拆分为多个 v3 Service
// （Hosts / Groups / Overview / Monitor / Files / TerminalSvc / Certs / Icons / System / Backup），
// 每个 Service 都是 App 的 defined type（字段共享，方法隔离）。
type App struct {
	sshMgr    *sshd.Manager
	collector *monitor.Collector
	agentPool *agentcli.Pool
	installer *agentinstall.Installer
	groups    *groups.Store
	hostIcons *hosticon.Store
	termMgr   *terminal.Manager

	app        *application.App
	mainWindow *application.WebviewWindow

	showMu     sync.Mutex
	sized      bool // 已有确定尺寸（上次窗口 或 本次按主屏计算）
	shown      bool
	resizeSave *time.Timer
}

// 按 grilling 时定下的策略：
//   - 错误处理静默失败 + 红色徽章 + 断线 30s 才重试
const RetryInterval = 30 * time.Second

// NewApp 构造并配置 Wails v3 应用：窗口 / 服务 / 文件拖放 / 生命周期。
// 返回的 *application.App 由 main.go 调用 Run。
func NewApp() *application.App {
	sshMgr := sshd.NewManager()
	core := &App{
		sshMgr:    sshMgr,
		termMgr:   terminal.NewManager(sshMgr),
		agentPool: agentcli.NewPool(sshMgr, connectOptionFor),
		installer: agentinstall.New(sshMgr),
	}

	app := application.New(application.Options{
		Name:        "1Pannel",
		Description: "运维管理",
		Services: []application.Service{
			application.NewService((*Hosts)(core)),
			application.NewService((*Groups)(core)),
			application.NewService((*Overview)(core)),
			application.NewService((*Monitor)(core)),
			application.NewService((*Agent)(core)),
			application.NewService((*Files)(core)),
			application.NewService((*TerminalSvc)(core)),
			application.NewService((*Certs)(core)),
			application.NewService((*Icons)(core)),
			application.NewService((*System)(core)),
			application.NewService((*Backup)(core)),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		OnShutdown: core.shutdown,
	})
	core.app = app

	// 主窗口：隐藏标题栏。Hidden 只等到「尺寸已确定」，立刻 Show 出 HTML 骨架，
	// 不再等 Vue 跑完（那会让 Dock 图标亮了窗口却迟迟不出来）。
	winW, winH := 1280, 800
	if sw, sh, ok := loadWindowGeom(); ok {
		winW, winH = sw, sh
		core.sized = true
	}
	winOpts := application.WebviewWindowOptions{
		Name:                       "main",
		Title:                      "1Pannel",
		Width:                      winW,
		Height:                     winH,
		MinWidth:                   windowMinW,
		MinHeight:                  windowMinH,
		BackgroundColour:           application.NewRGB(244, 244, 244),
		Hidden:                     true,
		InitialPosition:            application.WindowCentered,
		EnableFileDrop:             true,
		DefaultContextMenuDisabled: true,
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBarHidden,
			InvisibleTitleBarHeight: 32,
			Backdrop:                application.MacBackdropNormal,
		},
		URL: "/",
	}
	// Windows/Linux：无系统标题栏/菜单，窗口按钮画在应用内标题栏。
	// macOS 继续隐藏系统标题栏、保留左上红绿灯（不走 Frameless，否则红绿灯会被藏掉）。
	if goruntime.GOOS != "darwin" {
		winOpts.Frameless = true
		winOpts.Windows.DisableMenu = true
		winOpts.Windows.NonClientRegionSupport = true
	}
	win := app.Window.NewWithOptions(winOpts)
	core.mainWindow = win

	// 有上次尺寸：ApplicationStarted 后立刻 Show（骨架已在 HTML 里）。
	// 没有：按主屏算完再 Show，仍然不等 Vue。
	core.fitWindowToPrimaryScreen()
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		core.fitWindowToPrimaryScreen()
		core.maybeShowMainWindow()
	})
	win.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
		core.enforceMinSize()
		core.scheduleSaveGeom()
	})
	go func() {
		time.Sleep(800 * time.Millisecond)
		core.fitWindowToPrimaryScreen()
		core.forceShowMainWindow()
	}()

	// 初始化本地存储与采集器
	if store, err := groups.NewStore("ServerPanel"); err != nil {
		app.Logger.Error("初始化分组存储失败", "error", err)
	} else {
		core.groups = store
	}
	if hi, err := hosticon.NewStore("ServerPanel"); err != nil {
		app.Logger.Error("初始化主机图标存储失败", "error", err)
	} else {
		core.hostIcons = hi
	}
	core.collector = monitor.NewCollector(sshMgr)
	core.termMgr.Init(context.Background(), app.Event.Emit)

	// 应用内「重启应用」：前端确认后再发事件
	app.Event.On("app-restart", func(*application.CustomEvent) {
		core.restartApp()
	})

	// 必须显式设菜单：Wails 在 nil 时会装 DefaultApplicationMenu（含 View→Reload），
	// 会抢走 ⌘R。macOS 只留系统应用菜单（隐藏/退出）；不设 File/Edit/View/Window。
	core.installMinimalMenu(app)

	// 文件拖放：v2 的 OnFileDrop 回调 → v3 窗口事件 → 转发为前端自定义事件
	// 前端 useFileUpload / TerminalView / CertsView 订阅 "file:drop"
	win.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		files := e.Context().DroppedFiles()
		if len(files) > 0 {
			app.Event.Emit("file:drop", files)
		}
	})

	// 启动即预热全部主机 SSH / agent，不避让首屏
	go func() {
		sshd.TriggerLocalNetworkPrivacy()
		core.prewarmHosts()
	}()

	return app
}

func (a *App) shutdown() {
	if a.mainWindow != nil {
		w, h := a.mainWindow.Size()
		saveWindowGeom(w, h)
	}
	a.sshMgr.CloseAll()
	a.termMgr.CloseAll()
}

func (a *App) scheduleSaveGeom() {
	a.showMu.Lock()
	if a.resizeSave != nil {
		a.resizeSave.Stop()
	}
	win := a.mainWindow
	a.resizeSave = time.AfterFunc(200*time.Millisecond, func() {
		if win == nil {
			return
		}
		w, h := win.Size()
		saveWindowGeom(w, h)
	})
	a.showMu.Unlock()
}

// maybeShowMainWindow 尺寸已确定就立刻 Show（HTML 骨架先上屏，不等 Vue）。
func (a *App) maybeShowMainWindow() {
	a.showMu.Lock()
	if a.shown || a.mainWindow == nil || !a.sized {
		a.showMu.Unlock()
		return
	}
	win := a.mainWindow
	a.shown = true
	a.showMu.Unlock()
	win.SetMinSize(windowMinW, windowMinH)
	win.Center()
	win.Show()
}

func (a *App) forceShowMainWindow() {
	a.showMu.Lock()
	if a.shown || a.mainWindow == nil {
		a.showMu.Unlock()
		return
	}
	win := a.mainWindow
	a.shown = true
	a.showMu.Unlock()
	win.SetMinSize(windowMinW, windowMinH)
	win.Show()
}

func (a *App) enforceMinSize() {
	if a.mainWindow == nil {
		return
	}
	w, h := a.mainWindow.Size()
	nw, nh := w, h
	if nw < windowMinW {
		nw = windowMinW
	}
	if nh < windowMinH {
		nh = windowMinH
	}
	if nw != w || nh != h {
		a.mainWindow.SetMinSize(windowMinW, windowMinH)
		a.mainWindow.SetSize(nw, nh)
	}
}

// fitWindowToPrimaryScreen 按主屏分辨率计算 16:10 的窗口尺寸：
// 高度取屏幕的 80%，过宽时按屏幕宽度的 90% 反推（与 v2 startup 行为一致）。
// 必须在 Hidden 期间调用；成功后不再重复（避免覆盖用户后续的手动调整）。
func (a *App) fitWindowToPrimaryScreen() {
	a.showMu.Lock()
	if a.sized || a.mainWindow == nil || a.app == nil {
		a.showMu.Unlock()
		return
	}
	screen := a.app.Screen.GetPrimary()
	if screen == nil || screen.Size.Width <= 0 || screen.Size.Height <= 0 {
		a.showMu.Unlock()
		return
	}
	screenW, screenH := screen.Size.Width, screen.Size.Height
	h := screenH * 8 / 10
	w := h * 16 / 10
	if w > screenW*9/10 {
		w = screenW * 9 / 10
		h = w * 10 / 16
	}
	win := a.mainWindow
	a.sized = true
	a.showMu.Unlock()
	win.SetSize(w, h)
	win.Center()
	saveWindowGeom(w, h)
	a.app.Logger.Info("窗口按主屏自适应", "width", w, "height", h)
}

// installMinimalMenu 避免 Wails 默认菜单（View→Reload 会抢走 ⌘R）。
func (a *App) installMinimalMenu(app *application.App) {
	m := app.Menu.New()
	if goruntime.GOOS == "darwin" {
		m.AddRole(application.AppMenu)
	}
	app.Menu.SetApplicationMenu(m)
}

// restartApp 杀掉当前进程并重新启动应用：
// 先在后台拉起新实例，再 os.Exit(0)。子进程 fork 后由系统接管。
func (a *App) restartApp() {
	exe, err := os.Executable()
	if err != nil {
		if a.app != nil {
			a.app.Quit()
		}
		return
	}
	switch goruntime.GOOS {
	case "windows":
		// exe 来自 os.Executable（运行时信任来源），不经 shell 直接拉起新实例
		if p, err := os.StartProcess(exe, []string{exe}, &os.ProcAttr{}); err == nil {
			_ = p.Release()
		}
	case "darwin":
		bundle := filepath.Clean(filepath.Join(exe, "..", "..", ".."))
		// 路径经环境变量传入，脚本串保持全字面量，杜绝命令拼接
		c := exec.Command("sh", "-c", `sleep 1; open "$RESTART_TARGET"`)
		c.Env = append(os.Environ(), "RESTART_TARGET="+bundle)
		_ = c.Start()
	default:
		c := exec.Command("sh", "-c", `sleep 1; exec "$RESTART_TARGET"`)
		c.Env = append(os.Environ(), "RESTART_TARGET="+exe)
		_ = c.Start()
	}
	os.Exit(0)
}

// ============ 共享辅助 ============

// connectOptionFor 根据 host 名称从 ssh config 里查找对应连接参数
func connectOptionFor(host string) (sshd.ConnectOption, error) {
	hosts, err := sshconfig.Parse()
	if err != nil {
		return sshd.ConnectOption{}, err
	}
	for _, h := range hosts {
		if h.Name == host {
			return sshd.ConnectOption{
				Host:         h.Name,
				HostName:     h.HostName,
				User:         h.User,
				Port:         h.Port,
				IdentityFile: h.IdentityFile,
			}, nil
		}
	}
	return sshd.ConnectOption{}, fmt.Errorf("在 ~/.ssh/config 中未找到 Host: %s", host)
}

// rememberOS 把发行版写入本地记录，并通知前端即时换图标
func rememberOS(store *hosticon.Store, host, osRelease string) {
	host = strings.TrimSpace(host)
	osRelease = strings.TrimSpace(osRelease)
	if host == "" || osRelease == "" {
		return
	}
	if store != nil {
		if existing, ok := store.Get(host); ok && existing.OSRelease == osRelease {
			return
		}
		if err := store.Put(host, osRelease); err != nil {
			application.Get().Logger.Warn("保存主机图标失败", "host", host, "error", err)
		}
	}
	application.Get().Event.Emit("host-icon-updated", HostIcon{
		Host:      host,
		OSRelease: osRelease,
	})
}
