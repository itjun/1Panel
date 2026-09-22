package agent

import (
	"testing"
	"time"
)

func TestCertCheckDecision(t *testing.T) {
	loc := time.FixedZone("CST", 8*3600)
	at := func(day, hour int) time.Time {
		return time.Date(2026, 9, day, hour, 0, 0, 0, loc)
	}
	cases := []struct {
		name     string
		now      time.Time
		last     string
		scanNow  bool
		wantWait time.Duration
	}{
		{"before six, never scanned", at(22, 2), "", false, 4 * time.Hour},
		{"before six, scanned yesterday", at(22, 2), "2026-09-21", false, 4 * time.Hour},
		{"exactly six, not scanned", at(22, 6), "2026-09-21", true, 0},
		{"after six, missed", at(22, 10), "", true, 0},
		{"already scanned today", at(22, 10), "2026-09-22", false, 20 * time.Hour},
		{"already scanned, restart before next six", at(23, 2), "2026-09-22", false, 4 * time.Hour},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scanNow, wait := certCheckDecision(tc.now, tc.last)
			if scanNow != tc.scanNow || wait != tc.wantWait {
				t.Fatalf("scanNow=%v wait=%s want scanNow=%v wait=%s", scanNow, wait, tc.scanNow, tc.wantWait)
			}
		})
	}
}
