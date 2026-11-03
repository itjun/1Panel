//go:build linux

package localsys

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func readDiskModel(device string) (string, error) {
	name := filepath.Base(device)
	raw, err := os.ReadFile(filepath.Join("/sys/class/block", name, "device/model"))
	if os.IsNotExist(err) {
		return "", nil // 虚拟块设备等没有型号属性。
	}
	if err != nil {
		return "", fmt.Errorf("读取硬盘型号失败：%w", err)
	}
	return strings.TrimSpace(string(raw)), nil
}
