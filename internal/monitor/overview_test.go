package monitor

import "testing"

const netDevSample = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 123456 1000    0    0    0     0          0         0  123456   1000    0    0    0     0       0          0
  eth0: 100000 500     0    0    0     0          0         0  200000   600     0    0    0     0       0          0
docker0: 50000  100     0    0    0     0          0         0  60000    100     0    0    0     0       0          0
 veth1a: 30000  50      0    0    0     0          0         0  40000    50      0    0    0     0       0          0`

func TestParseNetDevDefaultIface(t *testing.T) {
	// 指定默认路由网卡时只统计该网卡（docker0/veth/lo 不计入）
	rx, tx := ParseNetDev(netDevSample, "eth0")
	if rx != 100000 || tx != 200000 {
		t.Fatalf("eth0 期望 rx=100000 tx=200000, 实际 rx=%d tx=%d", rx, tx)
	}
}

func TestParseNetDevFallback(t *testing.T) {
	// 探测失败时回退为除 lo 外全网卡合计
	wantRx, wantTx := uint64(180000), uint64(300000)
	rx, tx := ParseNetDev(netDevSample, "")
	if rx != wantRx || tx != wantTx {
		t.Fatalf("回退期望 rx=%d tx=%d, 实际 rx=%d tx=%d", wantRx, wantTx, rx, tx)
	}

	// 指定了不存在的网卡名也回退
	rx, tx = ParseNetDev(netDevSample, "notexist0")
	if rx != wantRx || tx != wantTx {
		t.Fatalf("未知网卡回退期望 rx=%d tx=%d, 实际 rx=%d tx=%d", wantRx, wantTx, rx, tx)
	}
}
