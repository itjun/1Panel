//go:build linux

package localsys

import (
	"strings"

	"github.com/shirou/gopsutil/v4/sensors"
)

// fillSystemTemps Linux：hwmon（gopsutil sensors.SensorsTemperatures）。
// SensorKey 即 hwmon name[+label]，如 coretemp_package_id_0 / k10temp / amdgpu_edge，
// 据此分类 CPU / GPU。读不到（虚拟机、无传感器）时保持 nil，前端显示「—」。
func fillSystemTemps(o *Overview) {
	stats, err := sensors.SensorsTemperatures()
	if err != nil || len(stats) == 0 {
		return
	}
	var cpuT, gpuT []float64
	for _, s := range stats {
		t := s.Temperature
		if t <= 0 || t > 120 {
			continue
		}
		key := strings.ToLower(s.SensorKey)
		isCPU := containsAny(key, "coretemp", "k10temp", "zenpower", "cpu_thermal",
			"x86_pkg_temp", "soc_thermal", "cpu-thermal", "package", "tdie", "tctl")
		isGPU := containsAny(key, "amdgpu", "i915", "nouveau", "radeon", "gpu", "edge")
		switch {
		case isCPU && !isGPU:
			cpuT = append(cpuT, t)
		case isGPU && !isCPU:
			gpuT = append(gpuT, t)
		}
	}
	if len(cpuT) > 0 {
		v := avgTemps(cpuT)
		o.CpuTempC = &v
	}
	if len(gpuT) > 0 {
		v := avgTemps(gpuT)
		o.GpuTempC = &v
	}
	if o.CpuTempC != nil {
		all := append(append([]float64(nil), cpuT...), gpuT...)
		v := avgTemps(all)
		o.TempC = &v
	}
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func avgTemps(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	var sum float64
	for _, x := range v {
		sum += x
	}
	return sum / float64(len(v))
}
