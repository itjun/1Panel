//go:build darwin

package localsys

import (
	"os"
	"testing"
)

func TestParseDiskMediaName(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{`<plist><dict><key>VolumeName</key><string>我的资料</string><key>MediaName</key><string> APPLE SSD AP0512Z </string></dict></plist>`, "APPLE SSD AP0512Z"},
		{`<plist><dict><key>MediaName</key><string>USB &amp; SATA Bridge</string></dict></plist>`, "USB & SATA Bridge"},
		{`<plist><dict><key>VolumeName</key><string>不是硬盘型号</string></dict></plist>`, ""},
	} {
		got, err := parseDiskMediaName([]byte(tc.raw))
		if err != nil || got != tc.want {
			t.Fatalf("got %q, %v; want %q", got, err, tc.want)
		}
	}
	if _, err := parseDiskMediaName([]byte(`<plist><dict><key>MediaName</key><string>`)); err == nil {
		t.Fatal("应拒绝损坏的 plist")
	}
}

func TestLiveDiskModel(t *testing.T) {
	if os.Getenv("LOCALSYS_LIVE") != "1" {
		t.Skip("设置 LOCALSYS_LIVE=1 读取本机型号")
	}
	disks := listDisks()
	isFound := false
	for _, disk := range disks {
		if disk.Kind != "disk" {
			continue
		}
		model, err := readDiskModel(disk.Device)
		if err != nil {
			t.Fatalf("%s：%v", disk.Device, err)
		}
		t.Logf("设备=%s 型号=%q", disk.Device, model)
		isFound = isFound || model != ""
	}
	if !isFound {
		t.Fatal("本机没有读到任何硬盘型号")
	}
}
