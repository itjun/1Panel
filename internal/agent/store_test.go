package agent

import (
	"context"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	return st
}

func TestOpenStoreWALMode(t *testing.T) {
	st := newTestStore(t)
	// journal_mode 是持久属性，读连接可验证
	var mode string
	if err := st.reader.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Fatalf("journal_mode = %q, 期望 wal", mode)
	}
	var uv int
	if err := st.reader.QueryRow(`PRAGMA user_version`).Scan(&uv); err != nil {
		t.Fatal(err)
	}
	if uv != schemaVersion {
		t.Fatalf("user_version = %d, 期望 %d", uv, schemaVersion)
	}
}

func TestWriteAndReadCurrent(t *testing.T) {
	st := newTestStore(t)
	now := time.Now().Unix()
	s := &Sample{
		TS: now, CPUPercent: 12.5, Load1: 0.5, Load5: 0.4, Load15: 0.3,
		MemUsed: 8 << 30, MemTotal: 16 << 30, SwapUsed: 0, SwapTotal: 4 << 30,
		NetRxBytes: 1000, NetTxBytes: 2000, NetRxKBps: 102.4, NetTxKBps: 51.2,
		DiskReadBytes: 5 << 20, DiskWriteBytes: 6 << 20, DiskReadKBps: 10, DiskWriteKBps: 20,
		DiskIOCount: 7, DiskUsed: 50 << 30, DiskTotal: 100 << 30,
	}
	if err := st.insertSample(s); err != nil {
		t.Fatal(err)
	}
	cur, err := st.Current()
	if err != nil {
		t.Fatal(err)
	}
	if cur.CPUPercent != 12.5 || cur.MemUsed != 8<<30 || cur.NetRxKBps != 102.4 {
		t.Fatalf("读回数据不一致: %+v", cur)
	}
}

func TestRangeRawAndAutoAgg(t *testing.T) {
	st := newTestStore(t)
	now := time.Now().Unix()
	// 写 10 分钟前的 5 个样本（间隔 60s）+ 现在的 1 个
	base := now - 600
	for i := 0; i < 5; i++ {
		if err := st.insertSample(&Sample{TS: base + int64(i)*60, CPUPercent: float64(i) * 10,
			NetRxKBps: 100, DiskReadKBps: 50, DiskWriteKBps: 25}); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.insertSample(&Sample{TS: now, CPUPercent: 99, NetRxKBps: 100, DiskReadKBps: 50, DiskWriteKBps: 25}); err != nil {
		t.Fatal(err)
	}

	// 显式 raw
	pts, src, err := st.Range(context.Background(), base-10, now+10, "raw")
	if err != nil {
		t.Fatal(err)
	}
	if src != "raw" || len(pts) != 6 {
		t.Fatalf("raw 查询: src=%s 点数=%d", src, len(pts))
	}

	// auto：跨度 > 3h → 走 agg（当前无聚合数据，返回空但 src=agg）
	_, src, err = st.Range(context.Background(), now-4*3600, now, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if src != "agg" {
		t.Fatalf("auto 跨度 4h 应选 agg，实际 %s", src)
	}
}

func TestAggregator(t *testing.T) {
	st := newTestStore(t)
	now := time.Now().Unix()
	// 两个已关闭的桶：每个桶 3 个样本
	b1 := (now - 700) / 300 * 300
	b2 := (now - 400) / 300 * 300
	for _, b := range []int64{b1, b2} {
		for i := 0; i < 3; i++ {
			if err := st.insertSample(&Sample{TS: b + int64(i)*100, CPUPercent: float64(20 + i*10),
				Load1: 1.5, MemUsed: 1000, NetRxKBps: 102.4, NetTxKBps: 0,
				DiskReadKBps: 0, DiskWriteKBps: 0}); err != nil {
				t.Fatal(err)
			}
		}
	}

	agg := NewAggregator(st)
	agg.backfill()
	agg.aggregateClosedBuckets(now)

	var count int
	if err := st.reader.QueryRow(`SELECT COUNT(*) FROM agg_metrics`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("聚合桶数 = %d, 期望 2", count)
	}
	var cpuMax float64
	var rxSum float64
	if err := st.reader.QueryRow(`SELECT cpu_max, net_rx_sum_mb FROM agg_metrics WHERE bucket = ?`, b1).
		Scan(&cpuMax, &rxSum); err != nil {
		t.Fatal(err)
	}
	if cpuMax != 40 {
		t.Fatalf("cpu_max = %v, 期望 40", cpuMax)
	}
	// 3 样本 × 102.4 KB/s × 5s / 1024 = 1.5 MB
	if d := rxSum - 1.5; d < -0.01 || d > 0.01 {
		t.Fatalf("net_rx_sum_mb = %v, 期望 1.5", rxSum)
	}
}

func TestCleanupBatched(t *testing.T) {
	st := newTestStore(t)
	now := time.Now().Unix()
	// 8 天前的旧数据 100 行（超 7 天保留）+ 新数据 10 行
	for i := 0; i < 100; i++ {
		if err := st.insertSample(&Sample{TS: now - 8*86400 - int64(i)}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 10; i++ {
		if err := st.insertSample(&Sample{TS: now - int64(i)*10}); err != nil {
			t.Fatal(err)
		}
	}
	// 旧 event
	if _, err := st.writer.Exec(`INSERT INTO events (ts, level, msg) VALUES (?,?,?)`,
		now-40*86400, "info", "old"); err != nil {
		t.Fatal(err)
	}

	c := NewCleanup(st, Retention{
		Raw: 7 * 24 * time.Hour, Agg: 90 * 24 * time.Hour, Events: 30 * 24 * time.Hour,
	})
	var total int64
	if err := c.cleanup(context.Background(), &total); err != nil {
		t.Fatal(err)
	}
	if total != 101 { // 100 旧 raw + 1 旧 event
		t.Fatalf("清理行数 = %d, 期望 101", total)
	}
	stats, err := st.Stats()
	if err != nil {
		t.Fatal(err)
	}
	if stats.RawCount != 10 {
		t.Fatalf("剩余 raw = %d, 期望 10", stats.RawCount)
	}
	if stats.EventCount != 0 {
		t.Fatalf("剩余 events = %d, 期望 0", stats.EventCount)
	}
}

func TestJarSampleRoundtrip(t *testing.T) {
	st := newTestStore(t)
	now := time.Now().Unix()
	if err := st.insertJarSample(&JarSample{
		TS: now, Service: "std", PID: 12, Port: 8301, RSS: 100, CPUPercent: 3.2,
		HeapUsed: 50, HeapMax: 200, GCPauseMs: 12, HealthOK: true,
	}); err != nil {
		t.Fatal(err)
	}
	pts, err := st.QueryJarRange(now-10, now+10, "std")
	if err != nil || len(pts) != 1 || !pts[0].HealthOK || pts[0].Port != 8301 {
		t.Fatalf("jar range: %+v %v", pts, err)
	}
}

func TestEvents(t *testing.T) {
	st := newTestStore(t)
	st.WriteEvent("info", "hello")
	// WriteEvent 走通道，直接同步写一条保证测试稳定
	st.insertEvent(writeOp{event: &Event{TS: time.Now().Unix(), Level: "warn", Msg: "direct"}})
	evs, err := st.Events(0, time.Now().Add(time.Hour).Unix(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].Msg != "direct" {
		t.Fatalf("事件读取异常: %+v", evs)
	}
}
