package menucheck

import (
	"testing"
	"time"
)

func TestInCheckWindow(t *testing.T) {
	cases := []struct {
		h, m int
		want bool
	}{
		{17, 59, false},
		{18, 0, true},
		{18, 5, true},
		{19, 59, true},
		{20, 0, true},
		{20, 1, false},
		{12, 0, false},
	}
	for _, c := range cases {
		tm := time.Date(2026, 9, 9, c.h, c.m, 0, 0, time.Local)
		if got := InCheckWindow(tm); got != c.want {
			t.Fatalf("%02d:%02d got %v want %v", c.h, c.m, got, c.want)
		}
	}
}
