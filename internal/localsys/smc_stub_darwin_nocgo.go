//go:build darwin && !cgo

package localsys

// 无 cgo 构建（仅类型检查 / 纯 Go 工具链）下的温度占位。
// 正式 macOS 构建始终启用 cgo，走 smc_darwin.go 的 AppleSMC 实现。
func fillSystemTemps(o *Overview) {}
