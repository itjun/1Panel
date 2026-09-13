package localsys

import (
	"testing"
)

func TestCPUCoreKind_PEOrder(t *testing.T) {
	// 4P + 6E = 10 核：0..3 perf，4..9 eff
	const perfN, effN, nCPU = 4, 6, 10
	for i := 0; i < nCPU; i++ {
		got := CPUCoreKind(i, perfN, effN, nCPU)
		want := "perf"
		if i >= perfN {
			want = "eff"
		}
		if got != want {
			t.Fatalf("index %d: kind=%q want %q", i, got, want)
		}
	}
}

func TestCPUCoreKind_NoTopology(t *testing.T) {
	cases := []struct {
		name           string
		index, p, e, n int
	}{
		{"zero_perf", 0, 0, 4, 8},
		{"zero_eff", 0, 4, 0, 8},
		{"overflow", 0, 6, 6, 10},
		{"out_of_range", 10, 4, 6, 10},
		{"negative", -1, 4, 6, 10},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := CPUCoreKind(tc.index, tc.p, tc.e, tc.n); got != "" {
				t.Fatalf("got %q, want empty", got)
			}
		})
	}
}

func TestBuildCPUCoreStats_KindsAndClamp(t *testing.T) {
	percents := []float64{12.5, 200, -3, 50, 0, 99.9}
	cores := BuildCPUCoreStats(percents, 2, 4)
	if len(cores) != 6 {
		t.Fatalf("len=%d", len(cores))
	}
	wantKinds := []string{"perf", "perf", "eff", "eff", "eff", "eff"}
	for i, c := range cores {
		if c.Index != i {
			t.Fatalf("cores[%d].Index=%d", i, c.Index)
		}
		if c.Kind != wantKinds[i] {
			t.Fatalf("cores[%d].Kind=%q want %q", i, c.Kind, wantKinds[i])
		}
	}
	if cores[1].Percent != 100 {
		t.Fatalf("clamp high: %v", cores[1].Percent)
	}
	if cores[2].Percent != 0 {
		t.Fatalf("clamp low: %v", cores[2].Percent)
	}
}

func TestBuildCPUCoreStats_Empty(t *testing.T) {
	if BuildCPUCoreStats(nil, 4, 6) != nil {
		t.Fatal("nil percents should yield nil")
	}
	if BuildCPUCoreStats([]float64{}, 4, 6) != nil {
		t.Fatal("empty percents should yield nil")
	}
}

func TestBuildCPUCoreStats_NoPE(t *testing.T) {
	cores := BuildCPUCoreStats([]float64{10, 20, 30}, 0, 0)
	for _, c := range cores {
		if c.Kind != "" {
			t.Fatalf("expected empty kind, got %q", c.Kind)
		}
	}
}
