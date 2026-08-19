package monitor

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// EgressInfo 出口公网信息（来自 myip.ipip.net）
type EgressInfo struct {
	IP       string `json:"ip"`
	Location string `json:"location"`
	Raw      string `json:"raw"`
}

// 解析 myip.ipip.net 返回的文本格式：
//   当前 IP：203.0.113.67  来自于：中国 示例 示例  示例运营商
var (
	reIPIPIPEgress = regexp.MustCompile(`(?:当前\s*IP|IP)\s*[：:]\s*([0-9a-fA-F:.]+)`)
	reIPIPLocEgress = regexp.MustCompile(`来自于\s*[：:]\s*(.+)`)
)

// FetchEgress 从本地访问 myip.ipip.net 获取出口公网 IP 与归属地
// 设计为侧栏/系统级别信息使用，不依赖任何主机。
func FetchEgress() (EgressInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "https://myip.ipip.net/", nil)
	if err != nil {
		return EgressInfo{}, err
	}
	req.Header.Set("User-Agent", "curl/8.0")
	req.Header.Set("Accept", "text/plain,*/*")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return EgressInfo{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
	if err != nil {
		return EgressInfo{}, err
	}
	raw := strings.TrimSpace(string(body))
	info := EgressInfo{Raw: raw}
	if m := reIPIPIPEgress.FindStringSubmatch(raw); m != nil {
		info.IP = m[1]
	}
	if m := reIPIPLocEgress.FindStringSubmatch(raw); m != nil {
		info.Location = strings.TrimSpace(m[1])
	}
	return info, nil
}
