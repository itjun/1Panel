//go:build darwin

package windowmaterial

import (
	"diteng-pannel/internal/macui"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func Automatic() string { return "acrylic" }
func Capability(material string) (bool, string) {
	if material == "mica" {
		return false, "原生云母仅支持 Windows 11 22H2 及以上，当前系统使用经典外观"
	}
	return macui.FrostedBackdropCapability()
}
func Apply(win *application.WebviewWindow, material string) error {
	return macui.SetFrostedBackdrop(win, material == "acrylic")
}
func Observe(changed func()) func()                             { return macui.ObserveTransparency(changed) }
func ConfigureWindow(options *application.WebviewWindowOptions) {}
func SetAppearance(win *application.WebviewWindow, mode string) {}
