package vmquery

import (
	"context"
	"net/http"
	"time"

	"diteng-pannel/internal/sshd"
)

// ProbeResult VM 可用性探测结果
type ProbeResult struct {
	Available bool   `json:"available"` // VM 是否在跑
	Version   string `json:"version"`   // VM 版本号（探测成功时填）
	LatencyMs int64  `json:"latencyMs"` // 健康检查往返耗时
	// 如果 Available=false，前端隐藏历史曲线，只显示实时值
}

// Probe 探测远端 VM 是否在跑、是否可达
//
// 只有 beta 装了 VM；cloud/raven 必须优雅降级——
// 探测失败时前端隐藏历史曲线，只显示实时值。
func (c *Client) Probe(host string, opt sshd.ConnectOption) ProbeResult {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	url := "http://" + VMAddr + "/health"

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return ProbeResult{Available: false}
	}

	// 每次都重新取 sshClient
	transport := c.httpClient.Transport.(*http.Transport)
	transport.DialContext = c.dialerFor(host, opt)

	start := time.Now()
	resp, err := c.httpClient.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return ProbeResult{Available: false}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return ProbeResult{Available: false}
	}

	return ProbeResult{
		Available: true,
		LatencyMs: latency,
	}
}
