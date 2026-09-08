package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CopyIDInput 是 CopySSHID 的入参
type CopyIDInput struct {
	Name          string `json:"name"`     // Host 别名
	HostName      string `json:"hostName"` // IP/域名
	User          string `json:"user"`
	Port          string `json:"port"`
	Password      string `json:"password"`      // 仅本次使用，不落盘
	PublicKeyFile string `json:"publicKeyFile"` // 默认 ~/.ssh/id_ed25519.pub
	IdentityFile  string `json:"identityFile"`  // 写入 ssh config 的密钥路径
}

// AddHostInput 是「添加主机」对话框的入参
// 端口默认 22，公钥/密钥路径由后端自动推断；备注存本机 host_meta.json
type AddHostInput struct {
	Name     string `json:"name"`     // Host 别名
	HostName string `json:"hostName"` // IP/域名
	User     string `json:"user"`
	Password string `json:"password"` // 仅本次使用，不落盘
	Note     string `json:"note"`     // 本机备注，可选
}

// UpdateHostInput 是「编辑主机」对话框的入参
// 别名不可在此接口修改（请用 RenameHost）；须带密码做连通性验证，通过后才写 config
type UpdateHostInput struct {
	Name     string `json:"name"`     // 现有 Host 别名
	HostName string `json:"hostName"` // 新 IP/域名
	User     string `json:"user"`     // 登录用户
	Password string `json:"password"` // 仅本次使用，不落盘
	Note     string `json:"note"`     // 本机备注，可选
}

// HostConnNotify 面板侧主机连接告警（停机 / 恢复）入参
type HostConnNotify struct {
	Webhook string `json:"webhook"` // 企微 webhook URL 或 key；空则跳过
	Host    string `json:"host"`    // 主机别名
	Kind    string `json:"kind"`    // down | up
	Detail  string `json:"detail"`  // 错误原文或恢复说明
}

// HostAlertNotify 面板侧资源超阈值 / 回落，或应用探活异常 / 恢复入参。
// Kind：mem | cpu | disk | load | app:<service>
type HostAlertNotify struct {
	Webhook string `json:"webhook"`
	Host    string `json:"host"`
	Kind    string `json:"kind"`  // mem | cpu | disk | load | app:<service>
	State   string `json:"state"` // down = 超阈值/异常, up = 已回落/恢复
	Detail  string `json:"detail"`
}

// DesktopNotify 本机系统通知入参；Host/EventID/Kind 写入通知 Data，点击后可跳转。
type DesktopNotify struct {
	Title   string `json:"title"`
	Body    string `json:"body"`
	Host    string `json:"host,omitempty"`
	EventID string `json:"eventId,omitempty"`
	Kind    string `json:"kind,omitempty"` // cpu|mem|disk|load
}

// MenuCheckResult 菜单检查：页面是否可开、是否有业务数据。
type MenuCheckResult struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	URL       string `json:"url"`
	OK        bool   `json:"ok"`
	HasData   bool   `json:"hasData"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	CheckedAt int64  `json:"checkedAt"`
	Scheduled bool   `json:"scheduled"`
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
