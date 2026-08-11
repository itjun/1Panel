package nethist

import (
	"testing"
	"time"
)

func TestWindowFromComplete1d(t *testing.T) {
	now := time.Now()
	samples := []Sample{
		{Ts: now.Add(-30 * time.Hour).Unix(), Rx: 1000, Tx: 2000},
		{Ts: now.Add(-20 * time.Hour).Unix(), Rx: 5000, Tx: 8000},
		{Ts: now.Add(-1 * time.Hour).Unix(), Rx: 9000, Tx: 12000},
	}
	curRx, curTx := uint64(10000), uint64(15000)
	w := windowFrom(samples, now, 24*time.Hour, curRx, curTx)
	// 基线应为 20h 前（最后一个 <= now-24h 的是 30h 前）
	// target = now-24h，samples[0] at -30h is base
	if w.RxBytes != curRx-1000 || w.TxBytes != curTx-2000 {
		t.Fatalf("got rx=%d tx=%d complete=%v span=%.1f", w.RxBytes, w.TxBytes, w.Complete, w.SpanHours)
	}
	if !w.Complete {
		t.Fatal("expected complete 1d window")
	}
}

func TestWindowFromIncomplete(t *testing.T) {
	now := time.Now()
	samples := []Sample{
		{Ts: now.Add(-2 * time.Hour).Unix(), Rx: 100, Tx: 200},
	}
	w := windowFrom(samples, now, 24*time.Hour, 500, 800)
	if w.Complete {
		t.Fatal("should be incomplete")
	}
	if w.RxBytes != 400 || w.TxBytes != 600 {
		t.Fatalf("delta wrong: %+v", w)
	}
}

func TestWindowFromReboot(t *testing.T) {
	now := time.Now()
	samples := []Sample{
		{Ts: now.Add(-30 * time.Hour).Unix(), Rx: 1_000_000, Tx: 2_000_000},
		// 重启后计数变小
		{Ts: now.Add(-10 * time.Hour).Unix(), Rx: 100, Tx: 200},
		{Ts: now.Add(-1 * time.Hour).Unix(), Rx: 500, Tx: 900},
	}
	w := windowFrom(samples, now, 24*time.Hour, 800, 1200)
	if w.Complete {
		t.Fatal("reboot window should not be complete")
	}
	// 应从重启后 100/200 起算
	if w.RxBytes != 700 || w.TxBytes != 1000 {
		t.Fatalf("got %+v", w)
	}
}
