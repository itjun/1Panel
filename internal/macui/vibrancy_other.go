//go:build !darwin

package macui

import "github.com/wailsapp/wails/v3/pkg/application"

func FrostedBackdropCapability() (bool, string) {
	return false, "本版本尚未提供原生亚克力，正在使用经典外观"
}
func SetFrostedBackdrop(win *application.WebviewWindow, enabled bool) error { return nil }
func ObserveTransparency(changed func()) func()                             { return func() {} }
