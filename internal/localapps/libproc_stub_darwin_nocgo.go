//go:build darwin && !cgo

package localapps

// 无 cgo 构建（仅类型检查 / 纯 Go 工具链）下的 libproc 占位。
// 正式 macOS 构建始终启用 cgo，走 libproc_darwin.go 实现。
func libprocPidPath(pid int) string { return "" }

func libprocDiskIO(pid int) (readBytes, writeBytes uint64, ok bool) { return 0, 0, false }

func libprocThreads(pid int) []ThreadNode { return nil }
