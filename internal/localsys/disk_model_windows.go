//go:build windows

package localsys

import (
	"encoding/binary"
	"fmt"

	"golang.org/x/sys/windows"
)

func readDiskModel(device string) (string, error) {
	path, err := windows.UTF16PtrFromString(device)
	if err != nil {
		return "", err
	}
	// 仅查询设备属性，不申请读写磁盘内容的权限。
	handle, err := windows.CreateFile(path, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return "", fmt.Errorf("打开磁盘信息失败：%w", err)
	}
	defer windows.CloseHandle(handle)

	const ioctlStorageQueryProperty = 0x002D1400
	query := make([]byte, 12) // StorageDeviceProperty = 0, PropertyStandardQuery = 0。
	header := make([]byte, 8)
	var returned uint32
	if err := windows.DeviceIoControl(handle, ioctlStorageQueryProperty, &query[0], uint32(len(query)), &header[0], uint32(len(header)), &returned, nil); err != nil {
		return "", fmt.Errorf("查询硬盘型号失败：%w", err)
	}
	if returned < 8 {
		return "", fmt.Errorf("磁盘信息头不完整")
	}
	size := binary.LittleEndian.Uint32(header[4:8])
	if size < 36 || size > 64*1024 {
		return "", fmt.Errorf("磁盘信息长度无效：%d", size)
	}
	buf := make([]byte, size)
	if err := windows.DeviceIoControl(handle, ioctlStorageQueryProperty, &query[0], uint32(len(query)), &buf[0], size, &returned, nil); err != nil {
		return "", fmt.Errorf("读取硬盘型号失败：%w", err)
	}
	if returned > size {
		return "", fmt.Errorf("磁盘信息长度超出缓冲区")
	}
	return parseStorageDeviceModel(buf[:returned])
}
