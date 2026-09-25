//go:build !darwin

package localapps

import "fmt"

// Scan 非 darwin 平台暂不支持。
func Scan() (*Snapshot, error) {
	return nil, fmt.Errorf("当前平台暂不支持本机应用监控")
}

// ProcDetail 非 darwin 平台暂不支持。
func ProcDetail(pid int) (*ProcNode, error) {
	return nil, fmt.Errorf("当前平台暂不支持本机应用监控")
}

// Resources 非 darwin 平台暂不支持。
func Resources(pid int) (*ResourceSnapshot, error) {
	return nil, fmt.Errorf("当前平台暂不支持本机应用监控")
}

// Kill 非 darwin 平台暂不支持。
func Kill(pid int, force bool) error {
	return fmt.Errorf("当前平台暂不支持本机应用监控")
}
