//go:build windows

package windowmaterial

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	dwm                  = windows.NewLazySystemDLL("dwmapi.dll")
	isCompositionEnabled = dwm.NewProc("DwmIsCompositionEnabled")
	systemParameters     = windows.NewLazySystemDLL("user32.dll").NewProc("SystemParametersInfoW")
	powerStatus          = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetSystemPowerStatus")
	appearance           atomic.Value
)

func Automatic() string { return "mica" }

func readPolicy() windowsPolicy {
	p := windowsPolicy{build: windows.RtlGetVersion().BuildNumber, transparency: true}
	if p.build < minimumMicaBuild {
		return p
	}
	var composition int32
	hr, _, _ := isCompositionEnabled.Call(uintptr(unsafe.Pointer(&composition)))
	p.composition = int32(hr) >= 0 && composition != 0
	var contrast struct {
		Size, Flags uint32
		Scheme      *uint16
	}
	contrast.Size = uint32(unsafe.Sizeof(contrast))
	ok, _, _ := systemParameters.Call(0x42, uintptr(contrast.Size), uintptr(unsafe.Pointer(&contrast)), 0)
	p.readFailed = ok == 0
	p.highContrast = contrast.Flags&1 != 0
	var power struct {
		AC, Battery, Percent, Saver byte
		Life, FullLife              uint32
	}
	ok, _, _ = powerStatus.Call(uintptr(unsafe.Pointer(&power)))
	p.readFailed = p.readFailed || ok == 0
	p.batterySaver = power.Saver == 1
	key, err := registry.OpenKey(registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err == nil {
		defer key.Close()
		if value, _, err := key.GetIntegerValue("EnableTransparency"); err == nil {
			p.transparency = value != 0
		} else if err != windows.ERROR_FILE_NOT_FOUND {
			p.readFailed = true
		}
		if value, _, err := key.GetIntegerValue("AppsUseLightTheme"); err == nil {
			p.dark = value == 0
		}
	} else if err != windows.ERROR_FILE_NOT_FOUND {
		p.readFailed = true
	}
	return p
}

func Capability(material string) (bool, string) {
	if material != "mica" {
		return false, "本版本尚未提供 Windows 原生亚克力，正在使用经典外观"
	}
	return micaCapability(readPolicy())
}

func ConfigureWindow(options *application.WebviewWindowOptions) {
	if windows.RtlGetVersion().BuildNumber >= minimumMicaBuild {
		// Keep the same WebView2 for live switching. Wails makes its surface
		// transparent; classic CSS remains opaque over the whole window.
		options.BackgroundType = application.BackgroundTypeTranslucent
		options.Windows.BackdropType = application.None
	}
}

func setAttribute(win *application.WebviewWindow, attribute uint32, value int32) error {
	if win == nil || win.NativeWindow() == nil {
		return fmt.Errorf("窗口尚未就绪")
	}
	return application.InvokeSyncWithError(func() error {
		hr := w32.DwmSetWindowAttribute(w32.HWND(uintptr(win.NativeWindow())), w32.DWMWINDOWATTRIBUTE(attribute), unsafe.Pointer(&value), unsafe.Sizeof(value))
		if hr < 0 {
			return fmt.Errorf("Windows 原生材质调用失败（0x%08X），正在使用经典外观", uint32(hr))
		}
		return nil
	})
}

func applyAppearance(win *application.WebviewWindow) error {
	dark := readPolicy().dark
	if mode, _ := appearance.Load().(string); mode == "light" {
		dark = false
	} else if mode == "dark" {
		dark = true
	}
	var value int32
	if dark {
		value = 1
	}
	return setAttribute(win, 20, value) // DWMWA_USE_IMMERSIVE_DARK_MODE
}

func Apply(win *application.WebviewWindow, material string) error {
	if windows.RtlGetVersion().BuildNumber < minimumMicaBuild {
		return nil
	}
	value := int32(1) // DWMSBT_NONE
	if material == "mica" {
		if err := applyAppearance(win); err != nil {
			return err
		}
		value = 2
	} // DWMSBT_MAINWINDOW: system-owned opaque Mica, including focus states.
	return setAttribute(win, 38, value) // DWMWA_SYSTEMBACKDROP_TYPE
}

func SetAppearance(win *application.WebviewWindow, mode string) {
	appearance.Store(mode)
	if windows.RtlGetVersion().BuildNumber >= minimumMicaBuild {
		_ = applyAppearance(win)
	}
}

func Observe(changed func()) func() {
	stop := make(chan struct{})
	initial := readPolicy()
	go func() {
		last := initial
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				next := readPolicy()
				if next != last {
					last = next
					changed()
				}
			}
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(stop) }) }
}
