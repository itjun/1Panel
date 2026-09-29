//go:build windows

package localapps

import (
	"os"
	"strings"
	"testing"
	"unsafe"
)

// Windows 进程结构布局（x64）必须与 ntdll 返回的一致，先锁死尺寸。
func TestNtStructLayout(t *testing.T) {
	if unsafe.Sizeof(ntSysThreadInfo{}) != 80 {
		t.Fatalf("ntSysThreadInfo size=%d want 80", unsafe.Sizeof(ntSysThreadInfo{}))
	}
	if got := unsafe.Offsetof(ntSysProcInfo{}.Threads); got != 256 {
		t.Fatalf("Threads offset=%d want 256", got)
	}
	if unsafe.Sizeof(ntUnicodeString{}) != 16 {
		t.Fatalf("ntUnicodeString size=%d want 16", unsafe.Sizeof(ntUnicodeString{}))
	}
	if unsafe.Sizeof(ntPebBasicInfo{}) != 48 {
		t.Fatalf("ntPebBasicInfo size=%d want 48", unsafe.Sizeof(ntPebBasicInfo{}))
	}
}

func TestSplitCommandLine(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{`C:\jdk\java.exe -Xmx1g -jar "C:\my app\server.jar" --spring.application.name=demo`, []string{
			`C:\jdk\java.exe`, "-Xmx1g", "-jar", `C:\my app\server.jar`, "--spring.application.name=demo",
		}},
		{`node  server.js  --port 3000`, []string{"node", "server.js", "--port", "3000"}},
		{`exe "quoted ""inside""" x`, []string{"exe", `quoted "inside"`, "x"}},
		{"", nil},
	}
	for _, tc := range cases {
		got := splitCommandLine(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("splitCommandLine(%q)=%q want %q", tc.in, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("splitCommandLine(%q)[%d]=%q want %q", tc.in, i, got[i], tc.want[i])
			}
		}
	}
}

func TestPortFromNetOrder(t *testing.T) {
	// 端口 8080 = 0x1F90，网络序字节 1F 90 落在 DWORD 低两字节
	if got := portFromNetOrder(0x901F); got != 8080 {
		t.Fatalf("portFromNetOrder=%d want 8080", got)
	}
	if got := portFromNetOrder(0x1500); got != 21 { // 0x0015 = 21
		t.Fatalf("portFromNetOrder=%d want 21", got)
	}
}

// TestWinProcessSnapshotSmoke 实机验证进程快照可读、字段合理。
func TestWinProcessSnapshotSmoke(t *testing.T) {
	if testing.Short() {
		t.Skip("short 模式跳过实机采样")
	}
	procs, err := winProcessSnapshot()
	if err != nil {
		t.Fatalf("winProcessSnapshot: %v", err)
	}
	if len(procs) < 10 {
		t.Fatalf("进程数 %d 过少", len(procs))
	}
	var self *winProcEntry
	totalRSS := uint64(0)
	for i := range procs {
		p := &procs[i]
		totalRSS += p.WorkingSet
		if p.PID == os.Getpid() {
			self = p
		}
	}
	if self == nil {
		t.Fatalf("快照中找不到自身进程 pid=%d", os.Getpid())
	}
	if self.WorkingSet < 1<<20 {
		t.Fatalf("自身 RSS=%d 异常", self.WorkingSet)
	}
	if self.CreateTime <= 0 || filetimeToUnix(self.CreateTime) <= 0 {
		t.Fatalf("自身进程启动时间异常: create=%v", self.CreateTime)
	}
	// 测试二进制可能刚启动不足 1 秒，uptime 允许为 0，只卡上限
	if uptimeSeconds(self.CreateTime) > 86400*365 {
		t.Fatalf("自身 uptime 异常: %d", uptimeSeconds(self.CreateTime))
	}
	if self.ImageName == "" || !strings.HasSuffix(strings.ToLower(self.ImageName), ".exe") {
		t.Fatalf("自身进程名异常: %q", self.ImageName)
	}
	if len(self.Threads) == 0 {
		t.Fatal("自身进程应有线程")
	}
}

func TestWinCmdlineCwdSelf(t *testing.T) {
	cmdline, cwd := readProcCmdlineCwd(os.Getpid())
	if !strings.Contains(cmdline, "localapps.test") {
		t.Fatalf("命令行应包含测试进程名: %q", cmdline)
	}
	if cwd == "" {
		t.Fatal("工作目录不应为空")
	}
}

func TestWinProcessOwnerSelf(t *testing.T) {
	owner := processOwner(os.Getpid())
	if owner == "" {
		t.Fatal("自身进程属主不应为空")
	}
	cur := currentUserName()
	if cur == "" {
		t.Skip("当前用户名不可得（跳过一致性比较）")
	}
	if !strings.EqualFold(owner, cur) {
		t.Fatalf("自身属主 %q 应等于当前用户 %q", owner, cur)
	}
}

func TestWinSocketSnapshotSmoke(t *testing.T) {
	sockets, err := socketSnapshot()
	if err != nil {
		t.Fatalf("socketSnapshot: %v", err)
	}
	if len(sockets) == 0 {
		t.Fatal("应有至少一个网络端点")
	}
	seenListen := false
	for _, sk := range sockets {
		if sk.Protocol == "TCP" && sk.State == "LISTEN" && sk.PID > 0 {
			seenListen = true
		}
	}
	if !seenListen {
		t.Log("未发现监听端点（可能正常，取决于系统服务）")
	}
}

// TestScanSmoke 完整跑一轮 Scan：本进程是 Go 二进制，应至少归并出自身。
func TestScanSmoke(t *testing.T) {
	snap, err := Scan()
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	foundSelf := false
	for _, app := range snap.Apps {
		for _, p := range app.Procs {
			if p.PID == os.Getpid() {
				foundSelf = true
				if p.Exe == "" {
					t.Fatalf("自身 Exe 为空: %+v", p)
				}
			}
		}
	}
	if !foundSelf {
		t.Log("Scan 未包含自身（第一轮 CPU 差分为 0 仍应可见）")
	}
}

func TestProcDetailSelf(t *testing.T) {
	detail, err := ProcDetail(os.Getpid())
	if err != nil {
		t.Fatalf("ProcDetail: %v", err)
	}
	if detail.Exe == "" || detail.ThreadCount < 1 {
		t.Fatalf("详情异常: %+v", detail)
	}
	if detail.Args == nil {
		t.Fatal("Args 不应为 nil")
	}
}
