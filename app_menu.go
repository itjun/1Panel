package main

import (
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ============ 系统菜单 / 应用生命周期辅助 ============

// buildAppMenu 构造 macOS 应用菜单。
// 第一个子菜单会被 macOS 当作应用菜单(粗体应用名)显示。
// 放弃 menu.AppMenu() role —— 它原子生成、无法插入自定义项。
// 菜单点击回调里读 a.ctx:用户点击发生在 startup 之后,ctx 已就绪。
func (a *App) buildAppMenu() *menu.Menu {
	m := menu.NewMenu()
	appSub := m.AddSubmenu("1Pannel")
	appSub.AddText("设置…", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
		runtime.EventsEmit(a.ctx, "open-settings")
	})
	// 原侧栏底部齿轮菜单迁移至系统菜单
	appSub.AddText("刷新", keys.CmdOrCtrl("r"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(a.ctx, "app-refresh")
	})
	appSub.AddText("检查并更新全部图标", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(a.ctx, "app-refresh-icons")
	})
	appSub.AddText("重启应用", nil, func(_ *menu.CallbackData) {
		a.restartApp()
	})
	appSub.AddSeparator()
	appSub.AddText("退出 1Pannel", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(a.ctx)
	})
	// 主机子菜单：与侧栏空白处右键菜单同源
	hostSub := m.AddSubmenu("主机")
	hostSub.AddText("添加主机…", keys.CmdOrCtrl("n"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(a.ctx, "open-add-host")
	})
	hostSub.AddText("新建分组…", nil, func(_ *menu.CallbackData) {
		runtime.EventsEmit(a.ctx, "open-create-group")
	})
	m.Append(menu.EditMenu())
	m.Append(menu.WindowMenu())
	return m
}

// restartApp 杀掉当前进程并重新启动应用:
// 先在后台 detach 一个「sleep 1; open <bundle>」(1 秒后起新实例),
// 然后当前进程 os.Exit(0) 自杀。子进程 fork 后由系统接管,不受父进程退出影响。
func (a *App) restartApp() {
	exe, err := os.Executable() // .../1Pannel.app/Contents/MacOS/1Pannel 或 .../1Pannel.exe
	if err != nil {
		runtime.Quit(a.ctx)
		return
	}
	if goruntime.GOOS == "windows" {
		// Windows: 直接重新拉起自己的 exe
		_ = exec.Command(exe).Start()
	} else {
		bundle := filepath.Clean(filepath.Join(exe, "..", "..", "..")) // → .../1Pannel.app
		_ = exec.Command("sh", "-c", "sleep 1; open "+strconv.Quote(bundle)).Start()
	}
	os.Exit(0) // 自杀
}
