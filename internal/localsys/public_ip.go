package localsys

import (
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	publicIPCacheTTL   = 10 * time.Minute
	publicIPRetryDelay = time.Minute
	publicIPHTTPTimeout = 3 * time.Second
)

var (
	rePublicIPIP  = regexp.MustCompile(`(?:当前\s*IP|IP)\s*[：:]\s*([0-9a-fA-F:.]+)`)
	rePublicIPv4  = regexp.MustCompile(`\b((?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))\b`)

	publicIPMu        sync.Mutex
	publicIPValue     string
	publicIPNext      time.Time
	publicIPRefreshing bool
)

// publicIPCached 返回已缓存的出口公网 IP；缓存过期时异步刷新，不阻塞调用方。
// 成功缓存 10 分钟；失败保留旧值，1 分钟后重试。
func publicIPCached() string {
	publicIPMu.Lock()
	defer publicIPMu.Unlock()
	if time.Now().Before(publicIPNext) {
		return publicIPValue
	}
	if !publicIPRefreshing {
		publicIPRefreshing = true
		go refreshPublicIP()
	}
	return publicIPValue
}

func refreshPublicIP() {
	defer func() {
		publicIPMu.Lock()
		publicIPRefreshing = false
		publicIPMu.Unlock()
	}()

	ip := fetchPublicIP()
	publicIPMu.Lock()
	defer publicIPMu.Unlock()
	if ip != "" {
		publicIPValue = ip
		publicIPNext = time.Now().Add(publicIPCacheTTL)
		return
	}
	// 失败保留旧值，短退避后重试
	publicIPNext = time.Now().Add(publicIPRetryDelay)
}

func fetchPublicIP() string {
	client := &http.Client{Timeout: publicIPHTTPTimeout}
	resp, err := client.Get("https://myip.ipip.net/")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return ""
	}
	ip, _ := parsePublicIPFromIPIP(string(body))
	return ip
}

// parsePublicIPFromIPIP 解析 https://myip.ipip.net/ 正文，示例：
// 当前 IP：203.0.113.67  来自于：中国 示例 示例  示例运营商
func parsePublicIPFromIPIP(raw string) (ip, loc string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	if strings.Contains(raw, "<") {
		raw = stripSimpleHTMLTags(raw)
	}
	if m := rePublicIPIP.FindStringSubmatch(raw); len(m) == 2 {
		cand := strings.TrimSpace(m[1])
		if net.ParseIP(cand) != nil {
			ip = cand
		}
	}
	if ip == "" {
		if m := rePublicIPv4.FindStringSubmatch(raw); len(m) == 2 {
			if net.ParseIP(m[1]) != nil {
				ip = m[1]
			}
		}
	}
	return ip, ""
}

func stripSimpleHTMLTags(s string) string {
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	return b.String()
}
