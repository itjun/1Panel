//go:build darwin

package localsys

import "testing"

func TestNginxIsRunningDetectsMaster(t *testing.T) {
	info, err := CollectNginx()
	if err != nil {
		t.Fatal(err)
	}
	if !info.Installed {
		t.Skip("nginx not installed")
	}
	// 本机 brew 服务已启动时应为 true；若未装服务则仅验证函数不 panic
	running := nginxIsRunning()
	t.Logf("installed=%v running=%v version=%s", info.Installed, running, info.Version)
	if info.Running != running {
		t.Fatalf("CollectNginx.Running=%v nginxIsRunning=%v", info.Running, running)
	}
}
