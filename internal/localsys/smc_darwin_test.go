//go:build darwin

package localsys

import "testing"

func TestFillSystemTemps_Live(t *testing.T) {
	o := &Overview{}
	fillSystemTemps(o)
	if o.TempC == nil && o.CpuTempC == nil && o.GpuTempC == nil {
		t.Skip("本机无可用 SMC 温度传感器")
	}
	if o.TempC != nil {
		if *o.TempC < 1 || *o.TempC > 120 {
			t.Fatalf("TempC=%v", *o.TempC)
		}
		t.Logf("temp=%.1f cpu=%v gpu=%v", *o.TempC, o.CpuTempC, o.GpuTempC)
	}
}
