//go:build darwin

package localsys

import "testing"

func TestParseIORegDiskStats(t *testing.T) {
	raw := `|   "Statistics" = {"Operations (Write)"=10,"Bytes (Read)"=1000,"Bytes (Write)"=2000,"Operations (Read)"=5}`
	read, write, ops := parseIORegDiskStats(raw)
	if read != 1000 || write != 2000 || ops != 15 {
		t.Fatalf("got read=%d write=%d ops=%d", read, write, ops)
	}
	// 多盘合计
	raw2 := raw + "\n" + `|   "Statistics" = {"Operations (Write)"=1,"Bytes (Read)"=100,"Bytes (Write)"=50,"Operations (Read)"=2}`
	read, write, ops = parseIORegDiskStats(raw2)
	if read != 1100 || write != 2050 || ops != 18 {
		t.Fatalf("sum got read=%d write=%d ops=%d", read, write, ops)
	}
}
