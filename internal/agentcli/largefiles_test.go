package agentcli

import (
	"context"
	"io"
	"net/http"
	"testing"
	"time"
)

type scanTransport func(*http.Request) (*http.Response, error)

func (f scanTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestLargestFilesTimeoutAndNoRetry(t *testing.T) {
	calls := 0
	c := &Client{token: "test-token", client: &http.Client{Transport: scanTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		deadline, ok := r.Context().Deadline()
		if !ok || time.Until(deadline) < 95*time.Second || time.Until(deadline) > 100*time.Second {
			t.Errorf("扫描请求没有预留 90 秒遍历时间: %v", deadline)
		}
		return nil, io.EOF
	})}}
	if err := c.GetJSON(context.Background(), "/collect/largest-files?root=%2F&limit=10", nil, true); err == nil {
		t.Fatal("断线必须报错")
	}
	if calls != 1 {
		t.Fatalf("扫描断线后不能自动重试，实际请求 %d 次", calls)
	}
}

func TestLargestFilesPropagatesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	c := &Client{token: "test-token", client: &http.Client{Transport: scanTransport(func(r *http.Request) (*http.Response, error) {
		cancel()
		select {
		case <-r.Context().Done():
			return nil, r.Context().Err()
		case <-time.After(time.Second):
			t.Fatal("调用方取消未传到 HTTP 请求")
			return nil, nil
		}
	})}}
	if err := c.GetJSON(ctx, "/collect/largest-files?root=%2F", nil, true); err == nil {
		t.Fatal("取消必须返回错误")
	}
}
