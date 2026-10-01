//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"diteng-pannel/internal/prochide"
)

// restrictKeyFile 收紧私钥 ACL：Windows OpenSSH 拒绝使用对其他用户可读的私钥
// （UNPROTECTED PRIVATE KEY FILE），chmod 在 Windows 上不生效。
func restrictKeyFile(path string) error {
	user := strings.TrimSpace(os.Getenv("USERNAME"))
	if user == "" {
		return nil
	}
	if domain := strings.TrimSpace(os.Getenv("USERDOMAIN")); domain != "" {
		user = domain + `\` + user
	}
	cmd := exec.Command("icacls", path, "/inheritance:r", "/grant:r", user+":F")
	prochide.Hide(cmd)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("设置私钥权限 %s 失败: %w: %s", path, err, strings.TrimSpace(string(out)))
	}
	return nil
}
