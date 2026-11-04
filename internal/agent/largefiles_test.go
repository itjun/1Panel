package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"diteng-pannel/internal/monitor"
)

func TestScanLargestFilesBatchesAndNames(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 400; i++ {
		p := filepath.Join(root, fmt.Sprintf("file-%04d", i))
		if err := os.WriteFile(p, make([]byte, i), 0600); err != nil {
			t.Fatal(err)
		}
	}
	name := " 空格\t换行\n文件 "
	if err := os.WriteFile(filepath.Join(root, name), make([]byte, 500), 0600); err != nil {
		t.Fatal(err)
	}
	// 符号链接不能重复计数，也不能递归到扫描目录外。
	if err := os.Symlink(root, filepath.Join(root, "loop")); err != nil {
		t.Fatal(err)
	}
	result, err := scanLargestFiles(context.Background(), root, 10)
	if err != nil || result.Incomplete || len(result.Files) != 10 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if result.Files[0].Name != name || result.Files[0].Size != 500 {
		t.Fatalf("文件名或排序错误: %+v", result.Files[0])
	}
	for i := 1; i < 10; i++ {
		if result.Files[i].Size != uint64(400-i) {
			t.Fatalf("Top 10 错误: %+v", result.Files)
		}
	}
}

func TestScanLargestFilesCancellationAndInvalidRoot(t *testing.T) {
	root := t.TempDir()
	for _, deadline := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		if deadline {
			cancel()
			ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
		}
		cancel()
		result, err := scanLargestFiles(ctx, root, 10)
		if err != nil || !result.Incomplete || result.Message == "" {
			t.Fatalf("取消/超时被误报为完整结果: %+v %v", result, err)
		}
	}
	for _, path := range []string{"relative", filepath.Join(root, "missing")} {
		if _, err := scanLargestFiles(context.Background(), path, 10); err == nil {
			t.Fatalf("非法目录没有报错: %s", path)
		}
	}
}

func TestLargestFilesHTTPBusyCancelAndRetry(t *testing.T) {
	s := &Server{}
	root := t.TempDir()
	request := func(ctx context.Context) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/collect/largest-files?root="+url.QueryEscape(root), nil).WithContext(ctx)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	s.isScanning.Store(true)
	if w := request(context.Background()); w.Code != http.StatusConflict {
		t.Fatalf("重复扫描未拒绝: %d %s", w.Code, w.Body.String())
	}
	s.isScanning.Store(false)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	w := request(ctx)
	var result monitor.LargeFilesResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || !result.Incomplete {
		t.Fatalf("取消请求没有传到扫描器: %s %v", w.Body.String(), err)
	}
	if s.isScanning.Load() {
		t.Fatal("取消后扫描锁未释放")
	}
	w = request(context.Background())
	if w.Code != http.StatusOK {
		t.Fatalf("取消后无法重新扫描: %d", w.Code)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Incomplete {
		t.Fatalf("空目录应完整返回: %s %v", w.Body.String(), err)
	}
}

func TestScanMemoryBudget(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		max, current string
		wantError    bool
	}{
		{"134217728", "117440511", false},
		{"134217728", "117440512", true},
		{"134217728", "134217728", true},
		{"max", "134217728", false},
		{"invalid", "0", true},
	} {
		if err := os.WriteFile(filepath.Join(dir, "memory.max"), []byte(tc.max), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "memory.current"), []byte(tc.current), 0600); err != nil {
			t.Fatal(err)
		}
		if err := checkScanMemory(dir); (err != nil) != tc.wantError {
			t.Fatalf("max=%s current=%s err=%v", tc.max, tc.current, err)
		}
	}
}

// 在遍历若干项后确定性地取消，验证保留已有 Top N 且不会标成完整结果。
type scanCancelContext struct {
	context.Context
	remaining int
	cancel    context.CancelFunc
}

func (c *scanCancelContext) Err() error {
	c.remaining--
	if c.remaining == 0 {
		c.cancel()
	}
	return c.Context.Err()
}
func TestScanCancellationDuringTraversal(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 300; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprint(i)), []byte("data"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result, err := scanLargestFiles(&scanCancelContext{Context: ctx, remaining: 150, cancel: cancel}, root, 10)
	if err != nil || !result.Incomplete || len(result.Files) != 10 {
		t.Fatalf("遍历中取消未保留明确标记的部分结果: %+v %v", result, err)
	}
}
