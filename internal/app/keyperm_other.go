//go:build !windows

package app

// restrictKeyFile Unix 上 writeKeyFile 已 chmod 0600，无需额外处理
func restrictKeyFile(string) error { return nil }
