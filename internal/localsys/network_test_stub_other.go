//go:build !darwin

package localsys

// ParseHardwarePortsForTest 非 darwin 占位，满足 hosts_test 编译。
func ParseHardwarePortsForTest(raw string) int { return 0 }
