//go:build !darwin

package macauth

import "fmt"

// AuthenticateWithSystem 非 macOS 不支持
func AuthenticateWithSystem(reason string) error {
	return fmt.Errorf("系统认证仅支持 macOS")
}

// VerifyPassword 非 macOS 不支持
func VerifyPassword(username, password string) error {
	return fmt.Errorf("本机密码认证仅支持 macOS")
}
