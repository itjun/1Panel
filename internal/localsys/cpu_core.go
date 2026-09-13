package localsys

// CPUCoreKind 按 Apple Silicon 惯例划分逻辑核类型：先性能核、再能效核。
// perfN/effN 无效或超出 nCPU 时返回空字符串。
func CPUCoreKind(index, perfN, effN, nCPU int) string {
	if index < 0 || index >= nCPU {
		return ""
	}
	if perfN <= 0 || effN <= 0 || perfN+effN > nCPU {
		return ""
	}
	if index < perfN {
		return "perf"
	}
	if index < perfN+effN {
		return "eff"
	}
	return ""
}

// BuildCPUCoreStats 由每核使用率与 P/E 拓扑生成 CPUCoreStat 列表。
func BuildCPUCoreStats(percents []float64, perfN, effN int) []CPUCoreStat {
	n := len(percents)
	if n == 0 {
		return nil
	}
	out := make([]CPUCoreStat, n)
	for i := 0; i < n; i++ {
		p := percents[i]
		if p < 0 {
			p = 0
		}
		if p > 100 {
			p = 100
		}
		out[i] = CPUCoreStat{
			Index:   i,
			Percent: p,
			Kind:    CPUCoreKind(i, perfN, effN, n),
		}
	}
	return out
}
