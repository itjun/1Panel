//go:build !darwin

package localsys

func fillSystemTemps(o *Overview) {
	// 非 macOS 无 SMC 温度
}
