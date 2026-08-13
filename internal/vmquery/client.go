// Package vmquery 通过 SSH 隧道查询远端 VictoriaMetrics。
//
// 设计要点：
//   - 每次查询都重新 sshMgr.GetClient(host, opt) 再 Dial，
//     不能闭包捕获 sshClient——sshd.Manager 的 keepalive 判死会
//     delete(m.conns, host) 并 Close 旧连接，旧 client 上建立的
//     TCP 隧道会一起失效。
//   - 用标准库 net/http + 自定义 Dialer，不引第三方。
//   - VictoriaMetrics 监听 127.0.0.1:8428，只在本机可达；
//     Mac 侧通过 SSH 隧道访问，对外表现就像访问本机。
package vmquery

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"
)

// VMPort 远端 VictoriaMetrics 监听端口（绑 127.0.0.1）
const VMPort = "8428"

// VMAddr 远端 VM 的 host:port
const VMAddr = "127.0.0.1:" + VMPort

// Client 通过 SSH 隧道查询远端 VM
type Client struct {
	mgr *sshd.Manager
	// 单例 http.Client，Transport 每次请求重新 Dial（走当前 SSH 连接）
	httpClient *http.Client
}

// NewClient 创建查询客户端
func NewClient(mgr *sshd.Manager) *Client {
	return &Client{
		mgr: mgr,
		httpClient: &http.Client{
			// 连接建立（含 SSH 握手）的总体超时，由 Transport.DialContext 控制
			// 这里给个宽裕值，真正的查询超时由 Query 的 ctx 控制
			Timeout: 0,
			Transport: &http.Transport{
				// 禁用 keep-alive 连接池：每次请求都要新建 SSH 隧道，
				// 因为 sshClient 可能已经被 keepalive 换掉
				DisableKeepAlives: true,
			},
		},
	}
}

// dialerFor 返回一个 Dialer，它通过指定 host 的当前 SSH 连接拨到 VM
// 关键：每次调用都重新 GetClient，避免用到已被 keepalive 关闭的旧连接
func (c *Client) dialerFor(host string, opt sshd.ConnectOption) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		// 每次都重新取 sshClient
		sshClient, err := c.mgr.GetClient(host, opt)
		if err != nil {
			return nil, fmt.Errorf("ssh 连接失败: %w", err)
		}
		// 通过 SSH 隧道拨到 127.0.0.1:8428
		conn, err := sshClient.Dial(network, VMAddr)
		if err != nil {
			return nil, fmt.Errorf("ssh 隧道拨号 %s 失败: %w", VMAddr, err)
		}
		return conn, nil
	}
}

// QueryResult VM 查询返回的原始 JSON 解析
type QueryResult struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		// vector 查询：[]Series；matrix 查询（range）：[]SeriesWithValues
		Result []map[string]interface{} `json:"result"`
	} `json:"data"`
	Error string `json:"error,omitempty"`
}

// Query 执行一条 PromQL instant 查询
// query: PromQL 表达式，如 jvm_memory_used_bytes{area="heap",app="diteng-oss"}
// 超时由调用方通过 ctx 控制（建议 10s）
func (c *Client) Query(ctx context.Context, host string, opt sshd.ConnectOption, query string) ([]byte, error) {
	url := fmt.Sprintf("http://%s/api/v1/query?query=%s", VMAddr, urlEncodeQuery(query))

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	// 临时替换 Transport 的 Dialer（每次请求都重新取 sshClient）
	transport := c.httpClient.Transport.(*http.Transport)
	transport.DialContext = c.dialerFor(host, opt)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("VM 返回 %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// QueryRange 执行 PromQL range 查询，用于画时序曲线
// start/end：时间戳（秒）；step：步长（秒）
func (c *Client) QueryRange(ctx context.Context, host string, opt sshd.ConnectOption, query string, start, end int64, step int) ([]byte, error) {
	url := fmt.Sprintf("http://%s/api/v1/query_range?query=%s&start=%d&end=%d&step=%d",
		VMAddr, urlEncodeQuery(query), start, end, step)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	transport := c.httpClient.Transport.(*http.Transport)
	transport.DialContext = c.dialerFor(host, opt)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("VM 返回 %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// urlEncodeQuery 简单 URL 编码 PromQL 里的特殊字符
// 不用 net/url.QueryEscape 是因为它会把 = , { } 也编码掉，VM 反而能接受这些原样
// 只需处理空格和 & 即可
func urlEncodeQuery(q string) string {
	// VM/Prometheus 的 query 参数支持原样的 PromQL 语法
	// 唯一必须编码的是空格（URL 里不允许空格）
	return strings.ReplaceAll(q, " ", "%20")
}

// ParseSeriesCount 从查询结果里数出 series 数量（用于探测）
func ParseSeriesCount(body []byte, result *QueryResult) int {
	// 简单计数：result 数组长度。具体 JSON 解析交给前端。
	// 这里只做粗略探测用。
	_ = body
	if result == nil {
		return 0
	}
	return len(result.Data.Result)
}

// 默认查询超时
const DefaultQueryTimeout = 10 * time.Second
