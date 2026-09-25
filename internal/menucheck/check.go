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

// Result 菜单检查结果：固定包含「菜单」「数据」两项状态。
type Result struct {
	OK       bool   `json:"ok"`       // 菜单正常（可达且识别到内容区）
	HasData  bool   `json:"hasData"`  // 数据正常（有业务数据）
	MenuText string `json:"menuText"` // 如「菜单正常」或「菜单异常：…」
	DataText string `json:"dataText"` // 如「数据正常」或「数据异常：…」
	Title    string `json:"title"`
	Message  string `json:"message"` // 两项合并文案（换行），供弹窗/通知
}

// Check 拉取 URL，判断菜单与数据是否正常。
func Check(rawURL string) Result {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return failMenu("检查地址为空")
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return failMenu("检查地址无效")
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
		return failMenu("构造请求失败: " + err.Error())
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 1Panel-MenuCheck")
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return failMenu("无法打开页面: " + err.Error())
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return failMenu("读取页面失败: " + err.Error())
	}
	text := string(body)
	title := extractTitle(text)

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		r := failMenu(fmt.Sprintf("页面不可用（HTTP %d）", resp.StatusCode))
		r.Title = title
		return r
	}

	if looksLikeLoginOrExpired(text, title) {
		r := failMenu("会话失效或需重新登录，请更新链接后重试")
		r.Title = title
		return r
	}

	if !strings.Contains(text, markerDataReport) {
		r := failMenu("未识别到「数据上报」内容区，请确认地址是否正确")
		r.Title = title
		return r
	}

	if strings.Contains(text, emptyDataReport) {
		return finish(true, false, "菜单正常", "数据异常：暂无人员上报数据", title)
	}

	return finish(true, true, "菜单正常", "数据正常", title)
}

func failMenu(reason string) Result {
	return finish(false, false, "菜单异常："+reason, "数据异常：菜单不可用，无法判断", "")
}

func finish(menuOK, dataOK bool, menuText, dataText, title string) Result {
	return Result{
		OK:       menuOK,
		HasData:  dataOK,
		MenuText: menuText,
		DataText: dataText,
		Title:    title,
		Message:  menuText + "\n" + dataText,
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
