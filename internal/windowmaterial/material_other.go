//go:build !darwin && !windows

package windowmaterial

import "github.com/wailsapp/wails/v3/pkg/application"

func Automatic() string { return "mica" }

func Capability(material string) (bool, string) {
	return false, "原生云母仅支持 Windows 11 22H2 及以上，当前系统使用经典外观"
}

func Apply(win *application.WebviewWindow, material string) error { return nil }
func Observe(changed func()) func()                               { return func() {} }
func ConfigureWindow(options *application.WebviewWindowOptions)   {}
func SetAppearance(win *application.WebviewWindow, mode string)   {}
