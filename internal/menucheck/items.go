package menucheck

import (
	"fmt"
	"strings"
)

// KV 请求参数或请求头的一行。Enabled=false 的行保留在配置里但不发送。
type KV struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

// Item 一条用户自定义巡检：请求定义 + 断言 + 定时规则。
type Item struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Method     string `json:"method"`
	URL        string `json:"url"`
	Query      []KV   `json:"query"`
	Headers    []KV   `json:"headers"`
	Body       string `json:"body"`
	TimeoutSec int    `json:"timeoutSec"`

	// ExpectStatus 形如 "200"、"2xx"、"200,204"；空表示 2xx–3xx 都算正常。
	ExpectStatus   string   `json:"expectStatus"`
	MustContain    []string `json:"mustContain"`
	MustNotContain []string `json:"mustNotContain"`

	ScheduleEnabled bool `json:"scheduleEnabled"`
	IntervalMin     int  `json:"intervalMin"`
	// WindowStart/WindowEnd 为 "HH:MM"；两者都空表示全天。End < Start 表示跨零点。
	WindowStart string `json:"windowStart"`
	WindowEnd   string `json:"windowEnd"`
}

const (
	defaultTimeoutSec  = 20
	maxTimeoutSec      = 120
	defaultIntervalMin = 5
	maxIntervalMin     = 24 * 60
)

// Normalize 清洗用户输入并补默认值；不校验 URL 合法性（发送时才判）。
func Normalize(it Item) Item {
	it.ID = strings.TrimSpace(it.ID)
	it.Label = strings.TrimSpace(it.Label)
	it.Method = strings.ToUpper(strings.TrimSpace(it.Method))
	if it.Method == "" {
		it.Method = "GET"
	}
	it.URL = strings.TrimSpace(it.URL)
	it.Query = normalizeKVs(it.Query)
	it.Headers = normalizeKVs(it.Headers)
	if it.TimeoutSec <= 0 {
		it.TimeoutSec = defaultTimeoutSec
	}
	if it.TimeoutSec > maxTimeoutSec {
		it.TimeoutSec = maxTimeoutSec
	}
	it.ExpectStatus = strings.TrimSpace(it.ExpectStatus)
	it.MustContain = normalizeStrings(it.MustContain)
	it.MustNotContain = normalizeStrings(it.MustNotContain)
	if it.IntervalMin <= 0 {
		it.IntervalMin = defaultIntervalMin
	}
	if it.IntervalMin > maxIntervalMin {
		it.IntervalMin = maxIntervalMin
	}
	it.WindowStart = strings.TrimSpace(it.WindowStart)
	it.WindowEnd = strings.TrimSpace(it.WindowEnd)
	return it
}

// Validate 保存前校验：名称、地址、时间窗格式、状态码表达式。
func Validate(it Item) error {
	if it.Label == "" {
		return fmt.Errorf("名称不能为空")
	}
	if it.URL == "" {
		return fmt.Errorf("请求地址不能为空")
	}
	if strings.ContainsAny(it.Method, " \t\r\n") {
		return fmt.Errorf("请求方法不能包含空白字符")
	}
	if (it.WindowStart == "") != (it.WindowEnd == "") {
		return fmt.Errorf("时间窗需同时填写开始和结束，或都留空")
	}
	if it.WindowStart != "" {
		if _, err := parseClock(it.WindowStart); err != nil {
			return fmt.Errorf("时间窗开始时间无效: %w", err)
		}
		if _, err := parseClock(it.WindowEnd); err != nil {
			return fmt.Errorf("时间窗结束时间无效: %w", err)
		}
	}
	if _, err := parseExpectStatus(it.ExpectStatus); err != nil {
		return err
	}
	return nil
}

func normalizeKVs(in []KV) []KV {
	out := make([]KV, 0, len(in))
	for _, kv := range in {
		kv.Key = strings.TrimSpace(kv.Key)
		if kv.Key == "" && strings.TrimSpace(kv.Value) == "" {
			continue
		}
		out = append(out, kv)
	}
	return out
}

func normalizeStrings(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func cloneItem(it Item) Item {
	it.Query = append([]KV{}, it.Query...)
	it.Headers = append([]KV{}, it.Headers...)
	it.MustContain = append([]string{}, it.MustContain...)
	it.MustNotContain = append([]string{}, it.MustNotContain...)
	return it
}
