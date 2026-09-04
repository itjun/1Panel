// Package wecom 提供企微群机器人 markdown 告警的构造与发送。
// 从 internal/agent 抽出为独立跨平台包：面板侧主机停机告警（system.go）
// 与 agent 侧探活告警共用同一 webhook 与版式，而面板不能依赖 Linux-only
// 的 agent 运行时包（含 Setpgid/Statfs 等 Unix 系统调用，Windows 编不过）。
package wecom

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// WatchNotify 企微 markdown 结构化字段（缺省字段不输出）
type WatchNotify struct {
	Level         string // critical / ok / warning
	Category      string // process / health / ingress / gc
	Host          string
	Service       string
	Runtime       string
	Port          int
	Entry         string
	Kind          string // down / up / spike
	TitleSuffix   string // 如「进程层挂了」
	Detail        string
	NotifyAt      time.Time
	ProcStartedAt time.Time // zero = 省略
	Source        string    // 发送端「Hostname 内网IP」；空则自动取本机
}

const wecomWebhookPrefix = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key="

// NormalizeWebhook 把 key 或完整 URL 规范成可 POST 的地址；空串仍为空。
func NormalizeWebhook(webhook string) string {
	webhook = strings.TrimSpace(webhook)
	if webhook == "" {
		return ""
	}
	if strings.HasPrefix(webhook, "http://") || strings.HasPrefix(webhook, "https://") {
		return webhook
	}
	return wecomWebhookPrefix + webhook
}

// NotifyWecom 向企业微信群机器人发送 markdown；webhook 为空则跳过。
func NotifyWecom(webhook, markdown string) error {
	url := NormalizeWebhook(webhook)
	if url == "" {
		return nil
	}
	body, err := json.Marshal(map[string]any{
		"msgtype":  "markdown",
		"markdown": map[string]string{"content": markdown},
	})
	if err != nil {
		return err
	}
	cli := &http.Client{Timeout: 8 * time.Second}
	resp, err := cli.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("企微 HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var wr struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if json.Unmarshal(raw, &wr) == nil && wr.ErrCode != 0 {
		return fmt.Errorf("企微 errcode=%d %s", wr.ErrCode, wr.ErrMsg)
	}
	return nil
}

// TestWebhook 向企业微信发送一条测试 markdown；地址为空或企微拒绝则返回错误。
func TestWebhook(webhook string) error {
	url := NormalizeWebhook(webhook)
	if url == "" {
		return fmt.Errorf("通知地址为空")
	}
	md := FormatWatchMarkdown(WatchNotify{
		Level:       "ok",
		Service:     "1Pannel",
		TitleSuffix: "通讯测试",
		Detail:      "设置页发出的测试消息。能在本群看到，说明企业微信通知地址可用。",
		NotifyAt:    time.Now(),
	})
	return NotifyWecom(url, md)
}

// FormatWatchMarkdown 格式化企微告警 markdown（agent 探活与面板主机告警共用）。
func FormatWatchMarkdown(n WatchNotify) string {
	// 标题：`[严重] 主机 的 服务 · 后缀`；正文只保留时间、内容。
	// 严重用 red，普通告警用 warning（橙），恢复用 info。
	badge := "[" + levelLabelCN(n.Level) + "]"
	badgeColor := "comment"
	switch n.Level {
	case "critical":
		badgeColor = "red"
	case "ok":
		badgeColor = "info"
	case "warning":
		badgeColor = "warning"
	}

	title := n.Service
	if n.Host != "" && n.Service != "" {
		title = n.Host + " 的 " + n.Service
	} else if n.Host != "" {
		title = n.Host
	}
	if n.TitleSuffix != "" {
		if title != "" {
			title = title + " · " + n.TitleSuffix
		} else {
			title = n.TitleSuffix
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "### <font color=\"%s\">%s</font> %s\n", badgeColor, badge, title)
	at := n.NotifyAt
	if at.IsZero() {
		at = time.Now()
	}
	appendQuote(&b, "时间", at.Format("2006-01-02 15:04:05"))
	if n.Detail != "" {
		appendQuote(&b, "内容", n.Detail)
	}
	src := strings.TrimSpace(n.Source)
	if src == "" {
		src = LocalSource()
	}
	if src != "" {
		appendQuote(&b, "来源", src)
	}
	return b.String()
}

func levelLabelCN(level string) string {
	switch level {
	case "critical":
		return "严重"
	case "ok":
		return "正常"
	case "warning":
		return "警告"
	default:
		return level
	}
}

func appendQuote(b *strings.Builder, key, val string) {
	fmt.Fprintf(b, ">%s: %s\n", key, val)
}

// EntryFromCmdline 从进程命令行提取入口（-jar 的 jar 名 / 脚本名），供告警展示。
func EntryFromCmdline(cmdline string) string {
	fields := strings.Fields(cmdline)
	for i, f := range fields {
		if f == "-jar" && i+1 < len(fields) {
			return shortEntry(fields[i+1])
		}
	}
	for _, f := range fields {
		if strings.HasSuffix(f, ".jar") {
			return shortEntry(f)
		}
	}
	// bun / node：取最后一个路径样参数
	for i := len(fields) - 1; i >= 0; i-- {
		f := fields[i]
		if strings.Contains(f, "/") && !strings.HasPrefix(f, "-") {
			return shortEntry(f)
		}
	}
	if len(fields) > 0 {
		return shortEntry(fields[len(fields)-1])
	}
	return ""
}

func shortEntry(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if i := strings.LastIndex(path, "/"); i >= 0 && i+1 < len(path) {
		return path[i+1:]
	}
	if len(path) > 80 {
		return path[:80] + "…"
	}
	return path
}
