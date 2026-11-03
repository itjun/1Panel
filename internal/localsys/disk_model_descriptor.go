package localsys

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"
)

// STORAGE_DEVICE_DESCRIPTOR 的解析不依赖 Windows，便于各平台验证长度与偏移边界。
func parseStorageDeviceModel(raw []byte) (string, error) {
	if len(raw) < 36 {
		return "", fmt.Errorf("磁盘信息不完整")
	}
	size := binary.LittleEndian.Uint32(raw[4:8])
	if size < 36 || uint64(size) > uint64(len(raw)) {
		return "", fmt.Errorf("磁盘信息长度无效")
	}
	raw = raw[:size]
	readString := func(at int) (string, error) {
		offset := binary.LittleEndian.Uint32(raw[at : at+4])
		if offset == 0 {
			return "", nil
		}
		if offset < 36 || offset >= size {
			return "", fmt.Errorf("磁盘型号偏移无效")
		}
		data := raw[offset:]
		end := bytes.IndexByte(data, 0)
		if end < 0 {
			return "", fmt.Errorf("磁盘型号字符串不完整")
		}
		return strings.TrimSpace(string(data[:end])), nil
	}
	product, err := readString(16)
	if err != nil || product == "" {
		return "", err // 厂商名本身不是硬盘型号。
	}
	vendor, err := readString(12)
	if err != nil {
		return "", err
	}
	if vendor == "" || strings.HasPrefix(strings.ToLower(product), strings.ToLower(vendor)) {
		return product, nil
	}
	return vendor + " " + product, nil
}
