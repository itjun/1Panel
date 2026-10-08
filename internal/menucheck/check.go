// Package menucheck 用户自定义的 HTTP 巡检：发请求、按断言判定、按时间窗定时执行。
package menucheck

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxBodyBytes   = 2 << 20
	maxPreviewSize = 4 << 10
	userAgent      = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 1Panel-Inspect"
)

var titleRE = regexp.MustCompile(`(?i)<title[^>]*>([^<]*)</title>`)

// Result 一次巡检结果：「请求」「内容」两项分别判定。
type Result struct {
	OK          bool   `json:"ok"`      // 请求正常（可达且状态码符合预期）
	HasData     bool   `json:"hasData"` // 内容正常（满足包含/不包含断言）
	MenuText    string `json:"menuText"`
	DataText    string `json:"dataText"`
	Title       string `json:"title"`
	Message     string `json:"message"`
	StatusCode  int    `json:"statusCode"`
	DurationMs  int64  `json:"durationMs"`
	BodyPreview string `json:"bodyPreview"`
}

// Passed 两项都正常。
func (r Result) Passed() bool { return r.OK && r.HasData }

// BuildURL 把启用的 Query 行拼到 URL 上（保留 URL 里已有的参数）。
func BuildURL(it Item) (*url.URL, error) {
	raw := strings.TrimSpace(it.URL)
	if raw == "" {
		return nil, fmt.Errorf("请求地址为空")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("请求地址无效，需以 http:// 或 https:// 开头")
	}
	q := u.Query()
	for _, kv := range it.Query {
		if !kv.Enabled || kv.Key == "" {
			continue
		}
		q.Add(kv.Key, kv.Value)
	}
	u.RawQuery = q.Encode()
	return u, nil
}

// Check 按巡检项定义发请求并执行断言。
func Check(it Item) Result {
	it = Normalize(it)
	u, err := BuildURL(it)
	if err != nil {
		return failRequest(err.Error(), 0, 0)
	}
	codes, err := parseExpectStatus(it.ExpectStatus)
	if err != nil {
		return failRequest(err.Error(), 0, 0)
	}

	var body io.Reader
	if it.Body != "" {
		body = strings.NewReader(it.Body)
	}
	req, err := http.NewRequest(it.Method, u.String(), body)
	if err != nil {
		return failRequest("构造请求失败: "+err.Error(), 0, 0)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "*/*")
	for _, kv := range it.Headers {
		if !kv.Enabled || kv.Key == "" {
			continue
		}
		if strings.EqualFold(kv.Key, "Host") {
			req.Host = kv.Value
			continue
		}
		req.Header.Set(kv.Key, kv.Value)
	}

	client := &http.Client{
		Timeout: time.Duration(it.TimeoutSec) * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 8 {
				return fmt.Errorf("重定向过多")
			}
			return nil
		},
	}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return failRequest("请求失败: "+err.Error(), 0, time.Since(start).Milliseconds())
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	elapsed := time.Since(start).Milliseconds()
	if err != nil {
		return failRequest("读取响应失败: "+err.Error(), resp.StatusCode, elapsed)
	}
	text := string(raw)
	title := extractTitle(text)
	preview := previewOf(text)

	if !statusMatches(resp.StatusCode, codes) {
		r := failRequest(fmt.Sprintf("状态码不符合预期（HTTP %d，期望 %s）", resp.StatusCode, expectLabel(it.ExpectStatus)), resp.StatusCode, elapsed)
		r.Title = title
		r.BodyPreview = preview
		return r
	}

	reqText := fmt.Sprintf("请求正常（HTTP %d，%d ms）", resp.StatusCode, elapsed)
	dataOK, dataText := assertContent(text, it.MustContain, it.MustNotContain)
	r := finish(true, dataOK, reqText, dataText)
	r.Title = title
	r.StatusCode = resp.StatusCode
	r.DurationMs = elapsed
	r.BodyPreview = preview
	return r
}

func assertContent(text string, must, mustNot []string) (bool, string) {
	if len(must) == 0 && len(mustNot) == 0 {
		return true, "内容正常（未配置内容断言）"
	}
	for _, s := range must {
		if !strings.Contains(text, s) {
			return false, fmt.Sprintf("内容异常：未包含「%s」", s)
		}
	}
	for _, s := range mustNot {
		if strings.Contains(text, s) {
			return false, fmt.Sprintf("内容异常：包含了「%s」", s)
		}
	}
	return true, "内容正常"
}

func failRequest(reason string, status int, ms int64) Result {
	r := finish(false, false, "请求异常："+reason, "内容异常：请求未成功，无法判断")
	r.StatusCode = status
	r.DurationMs = ms
	return r
}

func finish(reqOK, dataOK bool, reqText, dataText string) Result {
	return Result{
		OK:       reqOK,
		HasData:  dataOK,
		MenuText: reqText,
		DataText: dataText,
		Message:  reqText + "\n" + dataText,
	}
}

type statusRule struct {
	exact int // >0 精确匹配
	class int // 1–5，匹配 Nxx
}

// parseExpectStatus 解析 "200"、"2xx"、"200,204,3xx"；空串返回 nil（即 2xx–3xx）。
func parseExpectStatus(s string) ([]statusRule, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	var out []statusRule
	for _, part := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == '，' || r == ' ' }) {
		p := strings.ToLower(part)
		if len(p) == 3 && strings.HasSuffix(p, "xx") && p[0] >= '1' && p[0] <= '5' {
			out = append(out, statusRule{class: int(p[0] - '0')})
			continue
		}
		n, err := strconv.Atoi(p)
		if err != nil || n < 100 || n > 599 {
			return nil, fmt.Errorf("期望状态码「%s」无效，示例：200、2xx、200,204", part)
		}
		out = append(out, statusRule{exact: n})
	}
	return out, nil
}

func statusMatches(code int, rules []statusRule) bool {
	if len(rules) == 0 {
		return code >= 200 && code < 400
	}
	for _, r := range rules {
		if r.exact == code || (r.class > 0 && code/100 == r.class) {
			return true
		}
	}
	return false
}

func expectLabel(s string) string {
	if strings.TrimSpace(s) == "" {
		return "2xx/3xx"
	}
	return s
}

func previewOf(text string) string {
	if len(text) <= maxPreviewSize {
		if utf8.ValidString(text) {
			return text
		}
		return strings.ToValidUTF8(text, "�")
	}
	cut := text[:maxPreviewSize]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut + "\n…（已截断）"
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
