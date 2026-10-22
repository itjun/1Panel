package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"diteng-pannel/internal/updater"
)

func TestIsRetryableUpdateErr(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{nil, false},
		{context.Canceled, false},
		{context.DeadlineExceeded, true},
		{errors.New("下载中断：unexpected EOF"), true},
		{errors.New("下载失败：HTTP 404"), false},
		{errors.New("下载失败：HTTP 503"), true},
		{errors.New("安装包校验失败（sha256 不匹配）"), false},
		{io.ErrUnexpectedEOF, true},
	}
	for _, c := range cases {
		if got := isRetryableUpdateErr(c.err); got != c.want {
			t.Errorf("isRetryableUpdateErr(%v) = %v，期望 %v", c.err, got, c.want)
		}
	}
	if !isRetryableUpdateErr(&net.DNSError{IsTimeout: true}) {
		t.Fatal("DNS 超时应重试")
	}
}

func TestRunUpdateRetriesDisconnectedDownload(t *testing.T) {
	prev := updateRetryDelay
	updateRetryDelay = time.Millisecond
	t.Cleanup(func() { updateRetryDelay = prev })

	payload := []byte("0123456789abcdef0123456789abcdef")
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload[:4])
	}))
	defer srv.Close()

	sum := sha256.Sum256(payload)
	c := &updateController{
		app:    &App{},
		client: &updater.Client{Dir: t.TempDir()},
		state:  UpdateState{Status: updateDownloading},
	}
	c.runUpdate(context.Background(), updater.Asset{
		Name:   "pkg.zip",
		URL:    srv.URL + "/pkg.zip",
		SHA256: hex.EncodeToString(sum[:]),
		Size:   int64(len(payload)),
	})
	if calls.Load() != updateDownloadRetries+1 {
		t.Fatalf("应请求 %d 次，实际 %d", updateDownloadRetries+1, calls.Load())
	}
	st := c.snapshot()
	if st.Status != updateError || !strings.Contains(st.Error, "已自动重试 5 次") {
		t.Fatalf("最终状态不符：%s %s", st.Status, st.Error)
	}
}

func TestRunUpdateDoesNotRetryChecksumFailure(t *testing.T) {
	prev := updateRetryDelay
	updateRetryDelay = time.Millisecond
	t.Cleanup(func() { updateRetryDelay = prev })

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte("not-the-package"))
	}))
	defer srv.Close()

	c := &updateController{
		app:    &App{},
		client: &updater.Client{Dir: t.TempDir()},
		state:  UpdateState{Status: updateDownloading},
	}
	c.runUpdate(context.Background(), updater.Asset{
		Name:   "pkg.zip",
		URL:    srv.URL + "/pkg.zip",
		SHA256: hex.EncodeToString(make([]byte, 32)),
		Size:   int64(len("not-the-package")),
	})
	if calls.Load() != 1 {
		t.Fatalf("校验失败不应重试，实际请求 %d 次", calls.Load())
	}
	if c.snapshot().Status != updateError {
		t.Fatalf("状态应为 error：%s", c.snapshot().Status)
	}
}

func TestRunUpdateCancelDoesNotRetry(t *testing.T) {
	prev := updateRetryDelay
	updateRetryDelay = time.Millisecond
	t.Cleanup(func() { updateRetryDelay = prev })

	started := make(chan struct{})
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-r.Context().Done()
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	c := &updateController{
		app:    &App{},
		client: &updater.Client{Dir: t.TempDir()},
		state:  UpdateState{Status: updateDownloading},
	}
	go func() {
		<-started
		cancel()
	}()
	c.runUpdate(ctx, updater.Asset{
		Name:   "pkg.zip",
		URL:    srv.URL + "/pkg.zip",
		SHA256: hex.EncodeToString(make([]byte, 32)),
		Size:   8,
	})
	if calls.Load() != 1 {
		t.Fatalf("取消后不应重试，实际请求 %d 次", calls.Load())
	}
	if c.snapshot().Status != updateIdle {
		t.Fatalf("取消后应回到 idle：%s", c.snapshot().Status)
	}
}
