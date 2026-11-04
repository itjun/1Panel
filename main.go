package main

import (
	"log"
	"os"
	"time"

	"diteng-pannel/internal/app"
	"diteng-pannel/internal/updater"
)

func main() {
	// 隐藏子命令：deb 形态应用内更新经 pkexec 以 root 调用的安装助手，
	// 必须先于任何 GUI / 应用初始化执行并退出。
	if len(os.Args) > 1 && os.Args[1] == "update-apply" {
		os.Exit(updater.RunUpdateApply(os.Args[2:]))
	}
	// 重启接力：上实例拉起新进程后立即退出，本进程稍候待其（及 WebView2
	// 浏览器进程树）释放用户数据目录锁，避免新实例初始化 WebView2 失败。
	if v := os.Getenv("1PANNEL_RESTARTED"); v != "" {
		os.Unsetenv("1PANNEL_RESTARTED")
		time.Sleep(1500 * time.Millisecond)
	}
	desktop := app.NewApp(embeddedResources())
	if err := desktop.Run(); err != nil {
		log.Fatal(err)
	}
}
