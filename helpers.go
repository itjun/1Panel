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

// UpdateHostInput 是「编辑主机」对话框的入参
// 别名不可在此接口修改（请用 RenameHost）；须带密码做连通性验证，通过后才写 config
type UpdateHostInput struct {
	Name     string `json:"name"`     // 现有 Host 别名
	HostName string `json:"hostName"` // 新 IP/域名
	User     string `json:"user"`     // 登录用户
	Password string `json:"password"` // 仅本次使用，不落盘
}

// HostConnNotify 面板侧主机连接告警（停机 / 恢复）入参
type HostConnNotify struct {
	Webhook string `json:"webhook"` // 企微 webhook URL 或 key；空则跳过
	Host    string `json:"host"`    // 主机别名
	Kind    string `json:"kind"`    // down | up
	Detail  string `json:"detail"`  // 错误原文或恢复说明
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
