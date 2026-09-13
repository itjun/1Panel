//go:build darwin

package localsys

import (
	"testing"
	"time"
)

func TestSampleCPUClusterPercents(t *testing.T) {
	o, err := CollectOverview()
	if err != nil {
		t.Fatal(err)
	}
	if o.PerfCores <= 0 || o.EffCores <= 0 {
		t.Skip("no P/E topology")
	}
	// 第二次采集应有非零差分窗口
	time.Sleep(300 * time.Millisecond)
	o2, err := CollectOverview()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("total=%.2f perf=%.2f eff=%.2f cores=%d/%d perCore=%d",
		o2.CPUPercent, o2.PerfCPUPercent, o2.EffCPUPercent, o2.PerfCores, o2.EffCores, len(o2.CPUCores))
	if o2.CPUPercent < 0 || o2.CPUPercent > 100 {
		t.Fatalf("total out of range: %v", o2.CPUPercent)
	}
	if o2.PerfCPUPercent < 0 || o2.PerfCPUPercent > 100 {
		t.Fatalf("perf out of range: %v", o2.PerfCPUPercent)
	}
	if o2.EffCPUPercent < 0 || o2.EffCPUPercent > 100 {
		t.Fatalf("eff out of range: %v", o2.EffCPUPercent)
	}
	if len(o2.CPUCores) == 0 {
		t.Fatal("expected per-core stats")
	}
	if o2.CPUCount > 0 && len(o2.CPUCores) != o2.CPUCount {
		t.Fatalf("cpuCores len=%d cpuCount=%d", len(o2.CPUCores), o2.CPUCount)
	}
	for i, c := range o2.CPUCores {
		if c.Index != i {
			t.Fatalf("cpuCores[%d].Index=%d", i, c.Index)
		}
		if c.Percent < 0 || c.Percent > 100 {
			t.Fatalf("cpuCores[%d].Percent=%v", i, c.Percent)
		}
		want := CPUCoreKind(i, o2.PerfCores, o2.EffCores, len(o2.CPUCores))
		if c.Kind != want {
			t.Fatalf("cpuCores[%d].Kind=%q want %q", i, c.Kind, want)
		}
	}
}
