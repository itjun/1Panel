package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"diteng-pannel/internal/menucheck"
	"diteng-pannel/internal/wecom"
)

// CopyIDInput 是 CopySSHID 的入参
type CopyIDInput struct {
	Name          string `json:"name"`     // Host 别名
	HostName      string `json:"hostName"` // IP/域名
	User          string `json:"user"`
	Port          string `json:"port"`
	Password      string `json:"password"`      // 仅本次使用，不落盘（CopySSHID 本身不写 host_meta）
	PublicKeyFile string `json:"publicKeyFile"` // 默认 ~/.ssh/id_ed25519.pub
	IdentityFile  string `json:"identityFile"`  // 写入 ssh config 的密钥路径
}

// AddHostInput 是「添加主机」对话框的入参
// 端口默认 22，公钥/密钥路径由后端自动推断；备注与密码存本机 host_meta.json
type AddHostInput struct {
	Name     string `json:"name"`     // Host 别名
	HostName string `json:"hostName"` // IP/域名
	User     string `json:"user"`
	Password string `json:"password"` // 必填；验连后写入 host_meta
	Note     string `json:"note"`     // 本机备注，可选
}

// UpdateHostInput 是「编辑主机」对话框的入参
// 别名不可在此接口修改（请用 RenameHost）；须带密码做连通性验证，通过后才写 config
type UpdateHostInput struct {
	Name     string `json:"name"`     // 现有 Host 别名
	HostName string `json:"hostName"` // 新 IP/域名
	User     string `json:"user"`     // 登录用户
	Password string `json:"password"` // 必填；验连后写入 host_meta
	Note     string `json:"note"`     // 本机备注，可选
}

// HostConnNotify 面板侧主机连接告警（停机 / 恢复）入参
type HostConnNotify struct {
	Webhook string `json:"webhook"` // 企微 webhook URL 或 key；空则跳过
	Host    string `json:"host"`    // 主机别名
	Kind    string `json:"kind"`    // down | up
	Detail  string `json:"detail"`  // 错误原文或恢复说明
}

// HostAlertNotify 面板侧资源超阈值 / 回落，或应用探活异常 / 恢复，或证书到期 / 续期入参。
// Kind：mem | cpu | disk | load | app:<service> | cert
type HostAlertNotify struct {
	Webhook     string `json:"webhook"`
	Host        string `json:"host"`
	Kind        string `json:"kind"`  // mem | cpu | disk | load | app:<service> | cert
	State       string `json:"state"` // down = 超阈值/异常/到期, up = 已回落/恢复/续期
	Detail      string `json:"detail"`
	TitleSuffix string `json:"titleSuffix"` // 证书告警的企微标题后缀；空则走原有类型文案
	Expired     bool   `json:"expired"`     // 证书已过期时企微用严重，未过期用警告
	// Title / Lines 非空时企微按「标题 + 逐行字段」输出，与系统通知、应用内同一套文案。
	Title string       `json:"title"`
	Lines []wecom.Line `json:"lines"`
	// Level 资源告警档位：warn 显示 [警告]，danger 显示 [严重]；空则按类型推断。
	Level string `json:"level"`
}

// DesktopNotify 本机系统通知入参；Host/EventID/Kind 写入通知 Data，点击后可跳转。
type DesktopNotify struct {
	Title   string `json:"title"`
	Body    string `json:"body"`
	Host    string `json:"host,omitempty"`
	EventID string `json:"eventId,omitempty"`
	Kind    string `json:"kind,omitempty"` // cpu|mem|disk|load
}

// MenuCheckResult 巡检结果：请求是否正常、内容是否正常，附带当前配置供编辑回填。
type MenuCheckResult struct {
	ID          string         `json:"id"`
	Label       string         `json:"label"`
	Method      string         `json:"method"`
	URL         string         `json:"url"`
	OK          bool           `json:"ok"`      // 请求正常
	HasData     bool           `json:"hasData"` // 内容正常
	MenuText    string         `json:"menuText"`
	DataText    string         `json:"dataText"`
	Title       string         `json:"title"`
	Message     string         `json:"message"`
	StatusCode  int            `json:"statusCode"`
	DurationMs  int64          `json:"durationMs"`
	BodyPreview string         `json:"bodyPreview"`
	CheckedAt   int64          `json:"checkedAt"`
	Scheduled   bool           `json:"scheduled"`
	Config      menucheck.Item `json:"config"`
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
