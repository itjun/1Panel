//go:build linux

package localapps

import (
	"strings"
	"testing"
	"time"
)

func TestParseProcNetTCP(t *testing.T) {
	raw := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 67890 1 0000000000000000 100 0 0 10 0
   2: 0100007F:E8E7 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 99999 1 0000000000000000 20 0 0 10 -1
`
	got := ParseProcNetTCP(raw, "TCP")
	if len(got) != 2 {
		t.Fatalf("LISTEN 项应为 2，得到 %d: %+v", len(got), got)
	}
	if sk := got["12345"]; sk.local != "127.0.0.1:8080" {
		t.Fatalf("inode 12345 local=%q want 127.0.0.1:8080", sk.local)
	}
	if sk := got["67890"]; sk.local != "0.0.0.0:80" {
		t.Fatalf("inode 67890 local=%q want 0.0.0.0:80", sk.local)
	}
	if _, ok := got["99999"]; ok {
		t.Fatal("ESTABLISHED 连接不应计入监听表")
	}
}

func TestParseHexSockaddrIPv6(t *testing.T) {
	// ::1 的内核表示：末 32 位字小端为 01000000（已在真实 /proc/net/tcp6 核对）
	ip, ok := parseHexSockaddr("00000000000000000000000001000000:1F90")
	if !ok {
		t.Fatal("解析失败")
	}
	if ip != "[::1]:8080" && ip != "::1:8080" {
		// net.IP(::1).String() = "::1"
		t.Fatalf("got %q", ip)
	}
	if !strings.HasSuffix(ip, ":8080") || !strings.Contains(ip, "::1") {
		t.Fatalf("IPv6 环回地址格式异常: %q", ip)
	}
}

func TestParseStatusUID(t *testing.T) {
	raw := `Name:	code
Umask:	0022
State:	S (sleeping)
Tgid:	1234
Ngid:	0
Pid:	1234
PPid:	1000
Uid:	1000	1000	1000	1000
Gid:	1000	1000	1000	1000
`
	if got := parseStatusUID(raw); got != 1000 {
		t.Fatalf("parseStatusUID=%d want 1000", got)
	}
	if got := parseStatusUID("Name: x\n"); got != -1 {
		t.Fatalf("无 Uid 行应为 -1，得到 %d", got)
	}
}

func TestParseTaskStat(t *testing.T) {
	raw := `1234 (code) S 1000 1234 1234 0 -1 4194560 12345 0 0 0 120 60 0 0 20 0 6 0 987654 99999744 12345 18446744073709551615 94434846806016 94434847546781 140720317937376 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0 94434847934336 94434848081128 94434864408576 140720317941774 140720317941803 140720317941803 140720317941813 0
`
	state, ticks := parseTaskStat(raw)
	if state != "S" {
		t.Fatalf("state=%q want S", state)
	}
	if ticks != 180 { // utime 120 + stime 60
		t.Fatalf("ticks=%d want 180", ticks)
	}
}

// ---- 实机 smoke ----

func TestScanLinux(t *testing.T) {
	snap, err := Scan()
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if snap.SampledAt <= 0 {
		t.Fatal("SampledAt 异常")
	}
	// 测试进程自身应被识别为 go 运行时（本包测试二进制由 go 编译）
	foundSelf := false
	for _, app := range snap.Apps {
		for _, proc := range app.Procs {
			if proc.Extra["self"] == "1" {
				foundSelf = true
				if app.Runtime != "go" {
					t.Fatalf("自身应识别为 go 运行时，得到 %q", app.Runtime)
				}
				if proc.User == "" {
					t.Fatal("User 为空")
				}
				if proc.RSS == 0 {
					t.Fatal("RSS 为 0")
				}
			}
		}
	}
	if !foundSelf {
		t.Log("未在扫描结果中找到自身（可能被归并）——非致命")
	}
	t.Logf("apps=%d warnings=%v", len(snap.Apps), snap.Warnings)
}

func TestResourcesLinux(t *testing.T) {
	// go 测试进程自身持有若干 fd（测试文件、stdout 等）
	pid := int(0)
	procSelf := "/proc/self"
	_ = procSelf
	// 用 Scan 找自身 pid
	snap, err := Scan()
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
outer:
	for _, app := range snap.Apps {
		for _, proc := range app.Procs {
			if proc.Extra["self"] == "1" {
				pid = proc.PID
				break outer
			}
		}
	}
	if pid == 0 {
		t.Skip("未找到自身进程")
	}
	res, err := Resources(pid)
	if err != nil {
		t.Fatalf("Resources: %v", err)
	}
	if len(res.Resources) == 0 {
		t.Fatal("自身进程应至少打开若干 fd")
	}
	for _, r := range res.Resources {
		if r.Type == "socket" && r.Protocol == "" {
			t.Fatalf("socket 资源应带协议: %+v", r)
		}
	}
	_ = time.Now()
}

func TestParseSSProcNetBytes(t *testing.T) {
	raw := `Recv-Q Send-Q                            Local Address:Port                              Peer Address:Port
0      0                                   192.168.60.6:53336                            203.0.113.118:443   users:(("ZCode",pid=12067,fd=71))
	 cubic wscale:9,7 rto:212 rtt:9.138/2.095 mss:1400 bytes_sent:2475 bytes_acked:2476 bytes_received:6089 segs_out:12 segs_in:10
0      0                                     127.0.0.1:58032                                127.0.0.1:7890  users:(("mihomo-party",pid=11420,fd=19))
	 cubic wscale:7,7 rto:212 bytes_acked:2831 bytes_received:5678
0      0                                     10.0.0.1:999                                     1.2.3.4:80
	 cubic bytes_acked:100 bytes_received:200
0      0                                     127.0.0.1:25001                                127.0.0.1:47600 users:(("a",pid=101,fd=3),("b",pid=102,fd=4))
	 cubic bytes_acked:50 bytes_received:60
`
	got := ParseSSProcNetBytes(raw)
	if len(got) != 4 {
		t.Fatalf("应聚合 4 个 pid，得到 %d: %+v", len(got), got)
	}
	cases := []struct {
		pid     int
		in, out uint64
	}{
		{12067, 6089, 2476},
		{11420, 5678, 2831},
		{101, 60, 50}, // fork 共享套接字双方各计
		{102, 60, 50},
	}
	for _, tc := range cases {
		if got[tc.pid] != (netPair{in: tc.in, out: tc.out}) {
			t.Fatalf("pid %d = %+v, want in=%d out=%d", tc.pid, got[tc.pid], tc.in, tc.out)
		}
	}
}

func TestScanLinuxNetRates(t *testing.T) {
	// 两次扫描差分：系统上通常有后台 TCP 流量；无流量时不失败（跳过断言）
	if _, err := Scan(); err != nil {
		t.Fatalf("第一次 Scan: %v", err)
	}
	time.Sleep(1200 * time.Millisecond)
	snap, err := Scan()
	if err != nil {
		t.Fatalf("第二次 Scan: %v", err)
	}
	if len(snap.Warnings) > 0 {
		t.Fatalf("ss 可用时不应有网络警告，得到 %v", snap.Warnings)
	}
	rated := 0
	for _, app := range snap.Apps {
		for _, proc := range app.Procs {
			if proc.RateKnown && (proc.NetInRate > 0 || proc.NetOutRate > 0) {
				rated++
			}
		}
	}
	if rated == 0 {
		t.Log("本窗口内无 TCP 流量，未验证到非零网络速率（非致命）")
	} else {
		t.Logf("有网络速率的进程 %d 个", rated)
	}
}
