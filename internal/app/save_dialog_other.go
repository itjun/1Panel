//go:build !linux || !cgo || gtk3 || android || server

package app

// macOS、Windows 和 GTK3 会自己把 SetFilename 填进保存框。
func setLinuxSaveInitialName(string) {}
