//go:build !darwin

package main

// 非 macOS 无红绿灯按钮，空实现保持接口一致
func setTrafficLightsHidden(_ bool) {}
