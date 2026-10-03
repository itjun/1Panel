//go:build !linux || !cgo || gtk3 || android || server

package main

import "diteng-pannel/internal/macui"

// 非 Linux 桌面端没有需要纠正的 GTK 偏好：macOS 走 macui.SetWindowAppearance，
// Windows 的 WebView2 / macOS 的 WKWebView 都如实报告 prefers-color-scheme。
func (s *System) applyNativeAppearance(mode macui.AppearanceMode) {}

func (a *App) startNativeAppearanceWatch() {}

func (a *App) stopNativeAppearanceWatch() {}
