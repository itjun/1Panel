package agent

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 写测试用 /proc 目录
func writeProc(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	proc := filepath.Join(root, "proc")
	for name, content := range files {
		p := filepath.Join(proc, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return proc
}

const sampleStat = `cpu  100 0 100 700 10 0 0 0 0 0
cpu0 50 0 50 350 5 0 0 0 0 0
`
const sampleMeminfo = `MemTotal:       16000000 kB
MemFree:         4000000 kB
MemAvailable:    8000000 kB
Buffers:          100000 kB
SwapTotal:       4000000 kB
SwapFree:        3000000 kB
`
const sampleLoadavg = `0.52 0.58 0.59 1/800 12345
`
const sampleNetRoute = `Iface	Destination	Gateway 	Flags	RefCnt	Use	Metric	Mask		MTU	Window	IRTT
eth0	00000000	0100A8C0	0003	0	0	100	00000000	0	0	0
docker0	00000000	010011AC	0003	0	0	500	00000000	0	0	0
eth0	0000A8C0	00000000	0001	0	0	0	00FFFFFF	0	0	0
`
const sampleNetDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 5000000    5000    0    0    0     0          0         0  5000000    5000    0    0    0     0       0          0
  eth0: 1000000    2000    0    0    0     0          0         0  2000000    3000    0    0    0     0       0          0
docker0: 999999    1000    0    0    0     0          0         0  999999    1000    0    0    0     0       0          0
`
const sampleDiskstats = `   8       0 sda 12345 100 2000000 30000 15000 200 3000000 40000 0 40000 0 0 0 0
   8       1 sda1 100 0 50000 100 50 0 10000 200 0 100 0 0 0 0
 259       0 nvme0n1 5000 100 1000000 20000 6000 300 2000000 30000 0 50000 0 0 0 0
   7       0 loop0 100 0 1000 10 0 0 1000 10 0 10 0 0 0 0
 253       0 dm-0 100 0 1000 10 0 0 1000 10 0 10 0 0 0 0
`

func baseProcFiles() map[string]string {
	return map[string]string{
		"stat":      sampleStat,
		"meminfo":   sampleMeminfo,
		"loadavg":   sampleLoadavg,
		"net/route": sampleNetRoute,
		"net/dev":   sampleNetDev,
		"diskstats": sampleDiskstats,
	}
}

func TestCollectBasic(t *testing.T) {
	mc := NewMetricCollector(writeProc(t, baseProcFiles()))
	s, err := mc.Collect()
	if err != nil {
		t.Fatal(err)
	}
	// 首次采样：CPU 用累计近似（idle+iowait=710, total=910 → 约 21.98%）
	if s.CPUPercent <= 0 || s.CPUPercent >= 100 {
		t.Fatalf("CPU 近似值异常: %v", s.CPUPercent)
	}
	if s.MemTotal != 16000000*1024 {
		t.Fatalf("MemTotal = %d", s.MemTotal)
	}
	// MemAvailable 8000000 kB → used = (16000000-8000000)*1024
	if s.MemUsed != 8000000*1024 {
		t.Fatalf("MemUsed = %d", s.MemUsed)
	}
	if s.SwapUsed != 1000000*1024 {
		t.Fatalf("SwapUsed = %d", s.SwapUsed)
	}
	if s.Load1 != 0.52 || s.Load5 != 0.58 || s.Load15 != 0.59 {
		t.Fatalf("负载解析错误: %v/%v/%v", s.Load1, s.Load5, s.Load15)
	}
	// 默认路由 eth0（metric 100 < docker0 500）
	if s.NetRxBytes != 1000000 || s.NetTxBytes != 2000000 {
		t.Fatalf("网卡计数错误（应只统计 eth0）: rx=%d tx=%d", s.NetRxBytes, s.NetTxBytes)
	}
	// 物理盘：sda(2GB 读+3GB 写) + nvme0n1(1GB+2GB)，sda1/loop0/dm-0 排除
	if s.DiskReadBytes != (2000000+1000000)*512 {
		t.Fatalf("DiskReadBytes = %d", s.DiskReadBytes)
	}
	if s.DiskWriteBytes != (3000000+2000000)*512 {
		t.Fatalf("DiskWriteBytes = %d", s.DiskWriteBytes)
	}
	if s.NetRxKBps != 0 || s.DiskReadKBps != 0 {
		t.Fatalf("首次采样速率应为 0")
	}
}

func TestCollectDiffRates(t *testing.T) {
	proc := writeProc(t, baseProcFiles())
	mc := NewMetricCollector(proc)
	if _, err := mc.Collect(); err != nil {
		t.Fatal(err)
	}
	// 模拟 10 秒后：eth0 +1MiB 收 / +2MiB 发；sda 多读 10MiB（+20480 扇区）
	updated := sampleNetDevNew()
	if err := os.WriteFile(filepath.Join(proc, "net/dev"), []byte(updated.netDev), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(proc, "diskstats"), []byte(updated.diskstats), 0o644); err != nil {
		t.Fatal(err)
	}
	mc.mu.Lock()
	mc.lastMono = mc.lastMono.Add(-10 * time.Second)
	mc.mu.Unlock()

	s, err := mc.Collect()
	if err != nil {
		t.Fatal(err)
	}
	// 10 秒 1MiB → 102.4 KB/s（用近似断言容忍时钟误差）
	if d := s.NetRxKBps - 102.4; d < -3 || d > 3 {
		t.Fatalf("NetRxKBps = %v（期望约 102.4）", s.NetRxKBps)
	}
	if d := s.NetTxKBps - 204.8; d < -3 || d > 3 {
		t.Fatalf("NetTxKBps = %v（期望约 204.8）", s.NetTxKBps)
	}
	if d := s.DiskReadKBps - 1024; d < -30 || d > 30 {
		t.Fatalf("DiskReadKBps = %v（期望约 1024）", s.DiskReadKBps)
	}
}

// sampleNetDevNew 第二次采样的 /proc 内容：eth0 与 sda 计数器增长
func sampleNetDevNew() struct {
	netDev    string
	diskstats string
} {
	netDev := `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 5000000    5000    0    0    0     0          0         0  5000000    5000    0    0    0     0       0          0
  eth0: 2048576    2200    0    0    0     0          0         0  4097152    3300    0    0    0     0       0          0
docker0: 999999    1000    0    0    0     0          0         0  999999    1000    0    0    0     0       0          0
`
	diskstats := `   8       0 sda 12345 100 2020480 30000 15000 200 3000000 40000 0 40000 0 0 0 0
   8       1 sda1 100 0 50000 100 50 0 10000 200 0 100 0 0 0 0
 259       0 nvme0n1 5000 100 1000000 20000 6000 300 2000000 30000 0 50000 0 0 0 0
   7       0 loop0 100 0 1000 10 0 0 1000 10 0 10 0 0 0 0
 253       0 dm-0 100 0 1000 10 0 0 1000 10 0 10 0 0 0 0
`
	return struct {
		netDev    string
		diskstats string
	}{netDev, diskstats}
}

func TestCollectCounterReset(t *testing.T) {
	mc := NewMetricCollector(writeProc(t, baseProcFiles()))
	if _, err := mc.Collect(); err != nil {
		t.Fatal(err)
	}
	mc.mu.Lock()
	mc.lastMono = mc.lastMono.Add(-5 * time.Second)
	mc.lastNet = &[2]uint64{90000000, 90000000} // 大于当前值：模拟重启回绕
	mc.mu.Unlock()

	s, err := mc.Collect()
	if err != nil {
		t.Fatal(err)
	}
	if s.NetRxKBps != 0 {
		t.Fatalf("计数器回绕应得 0 速率，实际 %v", s.NetRxKBps)
	}
}

func TestDefaultRouteDev(t *testing.T) {
	if d := defaultRouteDev(sampleNetRoute); d != "eth0" {
		t.Fatalf("defaultRouteDev = %q, 期望 eth0", d)
	}
	if d := defaultRouteDev("garbage\nno routes here"); d != "" {
		t.Fatalf("无 default 路由应返回空，实际 %q", d)
	}
}

func TestGoArchToUname(t *testing.T) {
	cases := map[string]string{"amd64": "x86_64", "arm64": "aarch64", "riscv64": "riscv64"}
	for in, want := range cases {
		if got := goArchToUname(in); got != want {
			t.Fatalf("goArchToUname(%q) = %q, 期望 %q", in, got, want)
		}
	}
}
