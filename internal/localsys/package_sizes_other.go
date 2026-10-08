//go:build !darwin

package localsys

// CollectPackageSizes 目前仅 macOS 统计应用与数据占用。
func CollectPackageSizes() ([]PackageSize, error) { return nil, nil }
