//go:build !darwin

package localsys

import "fmt"

func CollectOverview() (*Overview, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}

func CollectNetwork() (*NetworkSnapshot, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}

func CollectPackages() ([]Package, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}

func CollectNginx() (*NginxInfo, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}

func NginxRead(path string) (string, error) {
	return "", fmt.Errorf("localsys: 仅支持 macOS")
}

func StorageScanStart() (*StorageStatus, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}

func StorageStatusSnapshot() *StorageStatus {
	return &StorageStatus{State: "idle"}
}

func StorageTree(path string) (*StorageNode, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}

func StorageApps() ([]StorageApp, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}

func StorageLargeFiles() ([]StorageFile, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}

func StorageReveal(path string) error {
	return fmt.Errorf("localsys: 仅支持 macOS")
}

func StorageOpenPrivacy() error {
	return fmt.Errorf("localsys: 仅支持 macOS")
}

func CollectSystemReport(force bool) (*SystemReport, error) {
	return nil, fmt.Errorf("localsys: 仅支持 macOS")
}
