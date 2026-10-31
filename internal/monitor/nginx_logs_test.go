package monitor

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// 用隔离文件执行真正的读取脚本，避免把错误结果当成空日志。
func TestNginxLogScriptStates(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("remote script requires a POSIX shell")
	}
	for _, kind := range []string{"nginx_access", "nginx_error"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			name := strings.TrimPrefix(kind, "nginx_") + ".log"
			path := filepath.Join(root, name)
			// 保留脚本原有引用方式；临时根目录先在 shell 内展开为参数。
			script := strings.ReplaceAll(buildLogScript(kind, 2), "/var/log/nginx/"+name, "${TEST_LOG}")
			script = strings.ReplaceAll(script, "-f ${TEST_LOG}", `-f "${TEST_LOG}"`)
			script = strings.ReplaceAll(script, "-r ${TEST_LOG}", `-r "${TEST_LOG}"`)
			script = strings.ReplaceAll(script, "tail -n 2 ${TEST_LOG}", `tail -n 2 "${TEST_LOG}"`)
			run := func() (string, error) {
				cmd := exec.Command("sh", "-c", script)
				cmd.Env = append(os.Environ(), "TEST_LOG="+path)
				out, err := cmd.CombinedOutput()
				return string(out), err
			}
			out, err := run()
			if err == nil || !strings.HasPrefix(out, "日志文件不存在：") {
				t.Fatalf("missing: %q %v", out, err)
			}
			if err := os.WriteFile(path, nil, 0600); err != nil {
				t.Fatal(err)
			}
			out, err = run()
			if got := parseLogResult(out); err != nil || got.Source != path || got.Content != "" {
				t.Fatalf("empty: %+v %v", got, err)
			}
			os.WriteFile(path, []byte("one\ntwo\nthree\n"), 0600)
			out, err = run()
			if got := parseLogResult(out); err != nil || strings.TrimSpace(got.Content) != "two\nthree" {
				t.Fatalf("tail: %+v %v", got, err)
			}
			if os.Geteuid() != 0 {
				os.Chmod(path, 0000)
				defer os.Chmod(path, 0600)
				out, err = run()
				if err == nil || !strings.HasPrefix(out, "没有权限读取日志：") {
					t.Fatalf("permission: %q %v", out, err)
				}
			}
		})
	}
}
