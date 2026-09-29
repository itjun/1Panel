//go:build windows

package localsys

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// 实机 smoke：验证 Windows 采集器在真实系统上返回合理数据。
// 这些测试同时是 CI（windows-latest）上的回归防线。

func TestCollectOverviewWin(t *testing.T) {
	o, err := CollectOverview()
	if err != nil {
		t.Fatalf("CollectOverview: %v", err)
	}
	if o.CPUCount != runtime.NumCPU() {
		t.Fatalf("CPUCount=%d want %d", o.CPUCount, runtime.NumCPU())
	}
	if o.CPUModel == "" {
		t.Fatal("CPUModel 为空")
	}
	if o.MemTotal < 1<<30 {
		t.Fatalf("MemTotal=%d 异常", o.MemTotal)
	}
	if o.MemUsed == 0 || o.MemUsed > o.MemTotal {
		t.Fatalf("MemUsed=%d 异常（total=%d）", o.MemUsed, o.MemTotal)
	}
	if !strings.Contains(o.OSRelease, "Windows") {
		t.Fatalf("OSRelease=%q", o.OSRelease)
	}
	if o.Kernel == "" || !strings.Contains(o.Kernel, "NT") {
		t.Fatalf("Kernel=%q", o.Kernel)
	}
	if o.Hostname == "" {
		t.Fatal("Hostname 为空")
	}
	if o.Uptime < 60 {
		t.Fatalf("Uptime=%d 异常", o.Uptime)
	}
	if len(o.CPUCores) != runtime.NumCPU() {
		t.Fatalf("CPUCores=%d want %d", len(o.CPUCores), runtime.NumCPU())
	}
	for _, c := range o.CPUCores {
		if c.Percent < 0 || c.Percent > 100 {
			t.Fatalf("核 %d 使用率异常: %v", c.Index, c.Percent)
		}
	}
	if o.CPUPercent < 0 || o.CPUPercent > 100 {
		t.Fatalf("CPUPercent=%v", o.CPUPercent)
	}
	foundC := false
	for _, d := range o.Disks {
		if d.Mount == `C:\` && d.Kind == "disk" {
			foundC = true
			if d.Total < 1<<30 {
				t.Fatalf("C 盘容量异常: %+v", d)
			}
			if d.FSType == "" {
				t.Fatalf("C 盘文件系统为空: %+v", d)
			}
		}
	}
	if !foundC {
		t.Fatalf("未找到 C:\\ 磁盘条目: %+v", o.Disks)
	}
	// 两次调用差分后应有网络计数
	if o.NetRxBytes == 0 && o.NetTxBytes == 0 {
		t.Log("网络计数为 0（离线机器可能正常）")
	}
}

func TestCollectOverviewWinTwiceForCPU(t *testing.T) {
	first, err := CollectOverview()
	if err != nil {
		t.Fatal(err)
	}
	second, err := CollectOverview()
	if err != nil {
		t.Fatal(err)
	}
	if second.CPUPercent < 0 || second.CPUPercent > 100 {
		t.Fatalf("二次采样 CPUPercent=%v", second.CPUPercent)
	}
	if len(second.CPUCores) == len(first.CPUCores) && len(second.CPUCores) > 0 {
		// 差分路径生效即可
		return
	}
}

func TestCollectNetworkWin(t *testing.T) {
	snap, err := CollectNetwork()
	if err != nil {
		t.Fatalf("CollectNetwork: %v", err)
	}
	if len(snap.Interfaces) == 0 {
		t.Fatal("无网卡")
	}
	hasUp := false
	for _, ifc := range snap.Interfaces {
		if ifc.State == "up" {
			hasUp = true
		}
		if ifc.MTU != 0 && ifc.MTU < 576 {
			t.Fatalf("MTU 异常: %+v", ifc)
		}
	}
	if !hasUp {
		t.Log("无活动网卡（离线环境可能正常）")
	}
}

func TestCollectPackagesWin(t *testing.T) {
	pkgs, err := CollectPackages()
	if err != nil {
		t.Fatalf("CollectPackages: %v", err)
	}
	if len(pkgs) < 10 {
		t.Fatalf("已安装软件 %d 过少", len(pkgs))
	}
	sources := map[string]bool{}
	for _, p := range pkgs {
		if p.Name == "" {
			t.Fatal("存在空名称条目")
		}
		sources[p.Source] = true
	}
	if !sources["system"] && !sources["system32"] && !sources["user"] {
		t.Fatalf("来源标记异常: %v", sources)
	}
}

func TestCollectHostsWin(t *testing.T) {
	info, err := CollectHosts()
	if err != nil {
		t.Fatalf("CollectHosts: %v", err)
	}
	found := false
	for _, e := range info.Entries {
		for _, n := range e.Names {
			if n == "localhost" {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("hosts 中未找到 localhost: %q", info.Raw)
	}
}

func TestProcessorQueueLengthWin(t *testing.T) {
	q, ok := processorQueueLength()
	if !ok {
		t.Skip("PDH 不可用（精简系统可能没有）")
	}
	if q < 0 || q > 10000 {
		t.Fatalf("队列长度异常: %v", q)
	}
}

func TestNginxWin(t *testing.T) {
	info, err := CollectNginx()
	if err != nil {
		t.Fatalf("CollectNginx: %v", err)
	}
	if !info.Installed {
		t.Log("本机未安装 nginx（Installed=false 为正常路径）")
	}
}

func TestWindowsVersionText(t *testing.T) {
	v := readWindowsVersion()
	if v.Build == "" {
		t.Skip("注册表无 CurrentBuildNumber")
	}
	if !strings.Contains(v.osReleaseText(), "Windows") {
		t.Fatalf("osReleaseText=%q", v.osReleaseText())
	}
	if !strings.Contains(v.kernelText(), "NT") {
		t.Fatalf("kernelText=%q", v.kernelText())
	}
}

func TestNginxDirVersion(t *testing.T) {
	cases := []struct {
		name string
		want [3]int
	}{
		{"nginx", [3]int{-1, -1, -1}},
		{"nginx-1.31.3", [3]int{1, 31, 3}},
		{"nginx-1.9", [3]int{1, 9, -1}},
		{"nginx-1.31.3-beta", [3]int{1, 31, 3}},
		{"nginx_1.24.0", [3]int{1, 24, 0}},
		{"unrelated", [3]int{-1, -1, -1}},
	}
	for _, tc := range cases {
		got := nginxDirVersion(tc.name)
		if got != tc.want {
			t.Fatalf("nginxDirVersion(%q)=%v want %v", tc.name, got, tc.want)
		}
	}
	// 数值比较：1.31.3 必须 > 1.9（字符串比较会判错）
	if !nginxVerGreater(nginxDirVersion("nginx-1.31.3"), nginxDirVersion("nginx-1.9")) {
		t.Fatal("1.31.3 应大于 1.9")
	}
}

func TestNginxExeInDir(t *testing.T) {
	root := t.TempDir()
	if got := nginxExeInDir(root); got != "" {
		t.Fatalf("空目录不应找到: %q", got)
	}
	direct := filepath.Join(root, "nginx-1.2.3")
	if err := os.MkdirAll(direct, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(direct, "nginx.exe"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := nginxExeInDir(direct)
	if !strings.HasSuffix(got, `nginx-1.2.3\nginx.exe`) {
		t.Fatalf("直属探测失败: %q", got)
	}
}

func TestWithinNginxTree(t *testing.T) {
	confDir := `C:\nginx-1.31.3\conf`
	cases := []struct {
		path string
		want bool
	}{
		{`C:\nginx-1.31.3\conf\nginx.conf`, true},
		{`C:\nginx-1.31.3\conf.d\lan.conf`, true}, // 平级 conf.d：安装根之内
		{`C:\nginx-1.31.3\html\index.html`, true},
		{`C:\nginx-1.31.3\..\secret.txt`, false},
		{`C:\Windows\System32\config.sys`, false},
		{`D:\etc\passwd`, false},
	}
	for _, tc := range cases {
		abs, err := filepath.Abs(tc.path)
		if err != nil {
			t.Fatal(err)
		}
		if got := withinNginxTree(confDir, abs); got != tc.want {
			t.Fatalf("withinNginxTree(%q)=%v want %v", tc.path, got, tc.want)
		}
	}
}
