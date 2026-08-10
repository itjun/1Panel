package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CopyIDInput 是 CopySSHID 的入参
type CopyIDInput struct {
	Name         string `json:"name"`         // Host 别名
	HostName     string `json:"hostName"`     // IP/域名
	User         string `json:"user"`
	Port         string `json:"port"`
	Password     string `json:"password"`     // 仅本次使用，不落盘
	PublicKeyFile string `json:"publicKeyFile"` // 默认 ~/.ssh/id_ed25519.pub
	IdentityFile  string `json:"identityFile"` // 写入 ssh config 的密钥路径
}

// AddHostInput 是「添加主机」对话框的入参（用户只需填 4 项）
// 端口默认 22，公钥/密钥路径由后端自动推断
type AddHostInput struct {
	Name     string `json:"name"`     // Host 别名
	HostName string `json:"hostName"` // IP/域名
	User     string `json:"user"`
	Password string `json:"password"` // 仅本次使用，不落盘
}

// readPublicKey 读公钥文件内容（去掉末尾换行）
func readPublicKey(path string) (string, error) {
	path = expandTilde(path)
	b, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("读取公钥失败: %w", err)
	}
	content := strings.TrimSpace(string(b))
	if content == "" {
		return "", fmt.Errorf("公钥文件为空: %s", path)
	}
	return content, nil
}

func expandTilde(p string) string {
	if strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}
