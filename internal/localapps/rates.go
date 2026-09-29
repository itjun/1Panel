package localapps

import "time"

// 速率差分（macOS / Windows 共用）：进程级 IO 计数在两次扫描间做差算速率。
type rateSample struct {
	at             time.Time
	diskRead       uint64
	diskWrite      uint64
	netIn          uint64
	netOut         uint64
	diskReadKnown  bool
	diskWriteKnown bool
	netKnown       bool
}

var rateHistory = map[int]rateSample{}

func applyRates(rp *RawProc, now time.Time) {
	prev, ok := rateHistory[rp.PID]
	sample := rateSample{
		at:             now,
		diskRead:       rp.DiskRead,
		diskWrite:      rp.DiskWrite,
		netIn:          rp.NetIn,
		netOut:         rp.NetOut,
		diskReadKnown:  true,
		diskWriteKnown: true,
		netKnown:       true,
	}
	rateHistory[rp.PID] = sample

	if !ok || prev.at.IsZero() {
		rp.RateKnown = false
		return
	}
	dt := now.Sub(prev.at).Seconds()
	if dt <= 0 {
		rp.RateKnown = false
		return
	}
	rp.RateKnown = true
	rp.DiskReadRate = ratePerSec(rp.DiskRead, prev.diskRead, dt)
	rp.DiskWriteRate = ratePerSec(rp.DiskWrite, prev.diskWrite, dt)
	rp.NetInRate = ratePerSec(rp.NetIn, prev.netIn, dt)
	rp.NetOutRate = ratePerSec(rp.NetOut, prev.netOut, dt)
}

func ratePerSec(cur, prev uint64, dt float64) uint64 {
	if cur < prev {
		// 进程重启或计数器回绕，本轮记 0
		return 0
	}
	return uint64(float64(cur-prev) / dt)
}
