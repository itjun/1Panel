//go:build windows

package localsys

func fillSystemTemps(o *Overview) {
	// Windows 无统一温度接口，保留 nil（前端显示「—」）
}
