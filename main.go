package main

import (
	"embed"
	"log"
	"os"
	"time"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// 重启接力：上实例拉起新进程后立即退出，本进程稍候待其（及 WebView2
	// 浏览器进程树）释放用户数据目录锁，避免新实例初始化 WebView2 失败。
	if v := os.Getenv("1PANNEL_RESTARTED"); v != "" {
		os.Unsetenv("1PANNEL_RESTARTED")
		time.Sleep(1500 * time.Millisecond)
	}
	app := NewApp()
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

