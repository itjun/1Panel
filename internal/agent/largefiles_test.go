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
	nested := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "nested-big"), make([]byte, 480), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := scanLargestFiles(context.Background(), root, 10)
	if err != nil || result.Incomplete || len(result.Files) != 10 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if result.Files[0].Name != name || result.Files[0].Size != 500 {
		t.Fatalf("文件名或排序错误: %+v", result.Files[0])
	}
	if result.Files[1].Name != "nested-big" || result.Files[1].Size != 480 {
		t.Fatalf("关闭父目录 FD 后再递归未扫到子目录: %+v", result.Files[1])
	}
	for i := 2; i < 10; i++ {
		if result.Files[i].Size != uint64(400-(i-1)) {
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
	const limit uint64 = 268435456 // 256 MiB
	if soft := scanMemorySoftCurrent(limit); soft != limit-limit/8 {
		t.Fatalf("soft=%d", soft)
	}
	// 256MiB 时 limit/32=8MiB > 4MiB，取较大头寸。
	if hard := scanMemoryHardCurrent(limit); hard != limit-(8<<20) {
		t.Fatalf("hard current=%d", hard)
	}
	if anon := scanMemoryHardAnon(limit); anon != limit-limit/4 {
		t.Fatalf("hard anon=%d", anon)
	}

	dir := t.TempDir()
	writeMem := func(max, current, stat string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, "memory.max"), []byte(max), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "memory.current"), []byte(current), 0600); err != nil {
			t.Fatal(err)
		}
		if stat == "" {
			_ = os.Remove(filepath.Join(dir, "memory.stat"))
			return
		}
		if err := os.WriteFile(filepath.Join(dir, "memory.stat"), []byte(stat), 0600); err != nil {
			t.Fatal(err)
		}
	}

	g := newScanMemoryGuard(dir)

	writeMem("max", "268435456", "anon 268435456\n")
	if err := g.checkWith(nil); err != nil {
		t.Fatalf("memory.max=max 应放行: %v", err)
	}

	writeMem("invalid", "0", "")
	if err := g.checkWith(nil); err == nil {
		t.Fatal("无效上限应报错")
	}

	// 7/8 soft：只回收，不停扫（这是上次误杀的根因）。
	writeMem("268435456", fmt.Sprint(scanMemorySoftCurrent(limit)), "anon 1024\n")
	g = newScanMemoryGuard(dir)
	reclaimCalls := 0
	if err := g.checkWith(func() { reclaimCalls++ }); err != nil || reclaimCalls != 1 {
		t.Fatalf("soft 应回收且继续: err=%v calls=%d", err, reclaimCalls)
	}

	// soft 冷却期内不再回收，仍不中止。
	reclaimCalls = 0
	if err := g.checkWith(func() { reclaimCalls++ }); err != nil || reclaimCalls != 0 {
		t.Fatalf("soft 冷却期应静默: err=%v calls=%d", err, reclaimCalls)
	}

	// 贴近硬顶：回收后降下来则放行。
	writeMem("268435456", fmt.Sprint(scanMemoryHardCurrent(limit)), "anon 1024\n")
	g = newScanMemoryGuard(dir)
	reclaimCalls = 0
	if err := g.checkWith(func() {
		reclaimCalls++
		if err := os.WriteFile(filepath.Join(dir, "memory.current"), []byte("100000000"), 0600); err != nil {
			t.Fatal(err)
		}
	}); err != nil || reclaimCalls != 1 {
		t.Fatalf("硬顶回收后应放行: err=%v calls=%d", err, reclaimCalls)
	}

	// 贴近硬顶且回收无效：停扫。
	writeMem("268435456", fmt.Sprint(limit), "anon 1024\n")
	g = newScanMemoryGuard(dir)
	reclaimCalls = 0
	if err := g.checkWith(func() { reclaimCalls++ }); err != errScanMemoryPressure || reclaimCalls != 1 {
		t.Fatalf("硬顶应停扫: err=%v calls=%d", err, reclaimCalls)
	}

	// anon 过高：停扫。
	writeMem("268435456", "100000000", fmt.Sprintf("anon %d\nfile 1\n", scanMemoryHardAnon(limit)))
	g = newScanMemoryGuard(dir)
	if err := g.checkWith(func() {}); err != errScanMemoryPressure {
		t.Fatalf("anon 硬顶应停扫: %v", err)
	}

	// 冷却未到且仍硬顶：直接停扫，不再回收。
	writeMem("268435456", fmt.Sprint(limit), "anon 1024\n")
	g = newScanMemoryGuard(dir)
	g.nextReclaim = time.Now().Add(time.Hour)
	if err := g.checkWith(func() { t.Fatal("冷却期内硬顶不应再回收") }); err != errScanMemoryPressure {
		t.Fatalf("冷却期硬顶应直接停扫: %v", err)
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
