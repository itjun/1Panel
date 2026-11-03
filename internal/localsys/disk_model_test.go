package localsys

import (
	"encoding/binary"
	"errors"
	"testing"
	"time"
)

func TestDiskModelCacheRefreshAndDetach(t *testing.T) {
	var cache diskModelCache
	now := time.Unix(1000, 0)
	calls := 0
	read := func(device string) (string, error) {
		calls++
		if device != "disk0" {
			t.Fatalf("不应查询挂载卷：%s", device)
		}
		return " APPLE SSD AP0512Z ", nil
	}
	disks := []DiskInfo{{Kind: "disk", Device: "disk0"}, {Kind: "mount", Device: "disk3"}}
	cache.fill(disks, now, read)
	cache.fill(disks, now.Add(time.Second), read)
	if calls != 1 || disks[0].Model != "APPLE SSD AP0512Z" || disks[1].Model != "" {
		t.Fatalf("缓存或物理盘范围错误：calls=%d disks=%+v", calls, disks)
	}
	cache.fill(disks, now.Add(time.Minute), read)
	if calls != 2 {
		t.Fatal("缓存过期应重新查询")
	}
	cache.fill(nil, now.Add(61*time.Second), read)
	cache.fill(disks, now.Add(62*time.Second), read)
	if calls != 3 {
		t.Fatal("设备重新接入后不应沿用旧型号")
	}
}

func TestDiskModelFailureDoesNotKeepOldModel(t *testing.T) {
	var cache diskModelCache
	now := time.Unix(1000, 0)
	disks := []DiskInfo{{Kind: "disk", Device: "disk0", Model: "old model"}}
	cache.fill(disks, now, func(string) (string, error) { return "", errors.New("没有读取权限") })
	if disks[0].Model != "" || disks[0].ModelError != "没有读取权限" {
		t.Fatalf("错误不应伪装成正常型号：%+v", disks[0])
	}
	cache.fill(disks, now.Add(5*time.Second), func(string) (string, error) { return "new model", nil })
	if disks[0].Model != "new model" || disks[0].ModelError != "" {
		t.Fatalf("失败后应能恢复：%+v", disks[0])
	}
}

func TestParseStorageDeviceModel(t *testing.T) {
	fixture := func(vendor, product string) []byte {
		raw := make([]byte, 36)
		binary.LittleEndian.PutUint32(raw[12:16], uint32(len(raw)))
		raw = append(raw, append([]byte(vendor), 0)...)
		binary.LittleEndian.PutUint32(raw[16:20], uint32(len(raw)))
		raw = append(raw, append([]byte(product), 0)...)
		binary.LittleEndian.PutUint32(raw[4:8], uint32(len(raw)))
		return raw
	}
	for _, tc := range []struct{ vendor, product, want string }{
		{"Samsung", "SSD 990 PRO 2TB", "Samsung SSD 990 PRO 2TB"},
		{"Samsung ", "Samsung SSD 990 PRO", "Samsung SSD 990 PRO"},
		{"", "WDC WD40EFAX", "WDC WD40EFAX"},
		{"Generic", "", ""},
	} {
		got, err := parseStorageDeviceModel(fixture(tc.vendor, tc.product))
		if err != nil || got != tc.want {
			t.Fatalf("got %q, %v; want %q", got, err, tc.want)
		}
	}
	badOffset := fixture("vendor", "model")
	binary.LittleEndian.PutUint32(badOffset[16:20], 0xffffffff)
	badSize := fixture("vendor", "model")
	binary.LittleEndian.PutUint32(badSize[4:8], 0xffffffff)
	unterminated := fixture("vendor", "model")
	unterminated[len(unterminated)-1] = 'X'
	for _, raw := range [][]byte{nil, make([]byte, 35), badOffset, badSize, unterminated} {
		if _, err := parseStorageDeviceModel(raw); err == nil {
			t.Fatal("应拒绝不完整或越界的设备描述")
		}
	}
}
