package agent

import (
	"context"
	"strings"
	"testing"
	"time"
)

// runShellCombined 的行为契约：合并输出、退出码映射、超时返回 DeadlineExceeded。
// 仅可在 unix（macOS/Linux）环境执行真实 sh 路径。
func TestRunShellCombinedBasics(t *testing.T) {
	out, err := runShellCombined("echo hello", 5*time.Second)
	if err != nil || string(out) != "hello\n" {
		t.Fatalf("echo: out=%q err=%v", out, err)
	}

	// stderr 并入输出
	out, err = runShellCombined("echo err-line 1>&2", 5*time.Second)
	if err != nil || string(out) != "err-line\n" {
		t.Fatalf("stderr-merge: out=%q err=%v", out, err)
	}

	// 非零退出码映射为 exit status N
	out, err = runShellCombined("exit 3", 5*time.Second)
	if err == nil || !strings.Contains(err.Error(), "exit status 3") {
		t.Fatalf("exit-code: out=%q err=%v", out, err)
	}
}

func TestRunShellCombinedTimeout(t *testing.T) {
	start := time.Now()
	_, err := runShellCombined("sleep 5", 1*time.Second)
	elapsed := time.Since(start)
	if err == nil || !strings.Contains(err.Error(), context.DeadlineExceeded.Error()) {
		t.Fatalf("timeout err=%v", err)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("超时后未及时返回: elapsed=%v", elapsed)
	}
}

func TestRunShellCombinedBigOutput(t *testing.T) {
	// 输出超过管道缓冲（64KB），验证读协程防死锁
	out, err := runShellCombined("for i in $(seq 1 20000); do echo line-$i; done", 15*time.Second)
	if err != nil || len(out) < 20000*10 {
		t.Fatalf("big-output: len=%d err=%v", len(out), err)
	}
}
