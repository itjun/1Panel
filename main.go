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
		Title:     "iPannel",
		Width:     1440,
		Height:    900,
		MinWidth:  1100,
		MinHeight: 700,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 24, G: 24, B: 27, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
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
			// 用普通原生标题栏，避免与红绿灯按钮位置冲突
			// 让 macOS 自己处理关闭/最小化/最大化按钮的位置
			TitleBar: mac.TitleBarDefault(),
			// 启用「Appearance: auto」让应用跟随系统主题切换
			Appearance: mac.DefaultAppearance,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
