// Package menucheck 检查业务菜单页是否可打开且有业务数据。
package menucheck

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	// 数据上报页空状态文案（FrmPurInventoryRecord）
	emptyDataReport = "暂无人员上报数据"
	// 页面主体区标题，用于确认已进入正确菜单而非登录壳
	markerDataReport = "数据上报信息"
)

var titleRE = regexp.MustCompile(`(?i)<title[^>]*>([^<]*)</title>`)

// Result 菜单检查结果。
type Result struct {
	OK      bool   `json:"ok"`      // HTTP 可达且不像登录失效页
	HasData bool   `json:"hasData"` // 有业务数据（非空状态）
	Title   string `json:"title"`
	Message string `json:"message"`
}

// Check 拉取 URL，判断是否可用且有数据。
func Check(rawURL string) Result {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return Result{Message: "检查地址为空"}
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return Result{Message: "检查地址无效"}
	}

	client := &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 8 {
				return fmt.Errorf("重定向过多")
			}
			return nil
		},
	}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return Result{Message: "构造请求失败: " + err.Error()}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 1Pannel-MenuCheck")
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return Result{Message: "无法打开页面: " + err.Error()}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return Result{Message: "读取页面失败: " + err.Error()}
	}
	text := string(body)
	title := extractTitle(text)

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return Result{
			Title:   title,
			Message: fmt.Sprintf("页面不可用（HTTP %d）", resp.StatusCode),
		}
	}

	if looksLikeLoginOrExpired(text, title) {
		return Result{
			Title:   title,
			Message: "页面会话失效或需重新登录，请更新链接后重试",
		}
	}

	if !strings.Contains(text, markerDataReport) {
		return Result{
			Title:   title,
			Message: "页面已打开，但未识别到「数据上报」内容区，请确认地址是否正确",
		}
	}

	if strings.Contains(text, emptyDataReport) {
		return Result{
			OK:      true,
			HasData: false,
			Title:   title,
			Message: "数据上报：暂无人员上报数据",
		}
	}

	return Result{
		OK:      true,
		HasData: true,
		Title:   title,
		Message: "数据上报：页面可用且已有上报数据",
	}
}

func extractTitle(html string) string {
	m := titleRE.FindStringSubmatch(html)
	if len(m) < 2 {
		return ""
	}
	t := strings.TrimSpace(m[1])
	if !utf8.ValidString(t) {
		return ""
	}
	return t
}

func looksLikeLoginOrExpired(html, title string) bool {
	lowTitle := strings.ToLower(title)
	if strings.Contains(title, "登录") || strings.Contains(lowTitle, "login") {
		if !strings.Contains(html, markerDataReport) {
			return true
		}
	}
	markers := []string{
		"请重新登录",
		"会话已过期",
		"登录已失效",
		"FrmLogin",
		"用户名或密码",
	}
	for _, m := range markers {
		if strings.Contains(html, m) && !strings.Contains(html, markerDataReport) {
			return true
		}
	}
	return false
}
