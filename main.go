package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "1Pannel",
		// 静态值仅作兜底：startup 时会按主屏分辨率动态计算 16:10 尺寸（见 app.go）
		Width:             1280,
		Height:            800,
		MinWidth:          1100,
		MinHeight:         700,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 24, G: 24, B: 27, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		// 自定义 macOS 应用菜单（设置… / 重启应用 / 退出）
		Menu:             app.buildAppMenu(),
		// 发布包默认也不要浏览器右键菜单；开发态另有前端 preventDefault 兜底
		EnableDefaultContextMenu: false,
		// 启用文件拖放：前端通过 OnFileDrop(callback) 接收本地文件绝对路径
		// 同时 DisableWebViewDrop=true，阻止 webview 默认行为（直接打开文件）
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			// 隐藏标题栏，红绿灯按钮保留在左上角（Obsidian/Notion 风格）
			// 用 TitleBarHidden 而非 TitleBarHiddenInset：后者启用 toolbar 模式会导致窗口无法 resize/双击放大
			TitleBar: mac.TitleBarHidden(),
			// 启用「Appearance: auto」让应用跟随系统主题切换
			Appearance: mac.DefaultAppearance,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
