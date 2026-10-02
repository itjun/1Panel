package main

// macOS 不在运行时设 Dock 图标：setApplicationIconImage 会用扁平 PNG 盖掉
// bundle 里 Assets.car 的分外观图标，深色/着色外观下被系统压暗。
func appIcon() []byte { return nil }
