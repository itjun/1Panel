//go:build !darwin

package macui

// SetDockIconVisible 非 macOS 无 Dock，无操作。
func SetDockIconVisible(visible bool) {}
