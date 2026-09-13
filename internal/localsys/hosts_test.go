package localsys

import "testing"

func TestParseHosts(t *testing.T) {
	raw := `# localhost
127.0.0.1 localhost
::1 localhost
# 10.0.0.1 blocked.example.com
192.168.1.10 app.local api.local # lan
`
	entries := ParseHosts(raw)
	if len(entries) != 4 {
		t.Fatalf("期望 4 条，得到 %d: %+v", len(entries), entries)
	}
	if entries[0].IP != "127.0.0.1" || entries[0].Disabled {
		t.Fatalf("条目0: %+v", entries[0])
	}
	if !entries[2].Disabled || entries[2].IP != "10.0.0.1" {
		t.Fatalf("注释禁用条目: %+v", entries[2])
	}
	if entries[3].Comment != "lan" || len(entries[3].Names) != 2 {
		t.Fatalf("带注释条目: %+v", entries[3])
	}
}

func TestParseSwapUsage(t *testing.T) {
	raw := "total = 3072.00M  used = 2320.94M  free = 751.06M  (encrypted)"
	total, used, ok := ParseSwapUsage(raw)
	if !ok {
		t.Fatal("解析失败")
	}
	wantTotal := uint64(3072 * 1024 * 1024)
	if total != wantTotal {
		t.Fatalf("total=%d want %d", total, wantTotal)
	}
	if used < 2320*1024*1024 || used > 2321*1024*1024 {
		t.Fatalf("used=%d 不在预期范围", used)
	}
}

func TestParseAPFSContainers(t *testing.T) {
	raw := `
APFS Containers (1 found)
|
+-- Container disk3 B407FC5C-FC66-4E33-B993-1C92162A0BD5
    ====================================================
    APFS Container Reference:     disk3
    Size (Capacity Ceiling):      494384795648 B (494.4 GB)
    Capacity In Use By Volumes:   335468593152 B (335.5 GB) (67.9% used)
    Capacity Not Allocated:       158916202496 B (158.9 GB) (32.1% free)
`
	got := ParseAPFSContainers(raw)
	if len(got) != 1 {
		t.Fatalf("期望 1 个容器，得到 %d", len(got))
	}
	if got[0].Device != "disk3" || got[0].Kind != "disk" {
		t.Fatalf("容器元数据: %+v", got[0])
	}
	if got[0].Total != 494384795648 || got[0].Used != 335468593152 {
		t.Fatalf("容量: total=%d used=%d", got[0].Total, got[0].Used)
	}
}

func TestParseHardwarePorts(t *testing.T) {
	raw := `Hardware Port: Wi-Fi
Device: en0
Ethernet Address: aa:bb:cc:dd:ee:ff

Hardware Port: Ethernet Adapter (en3)
Device: en3
Ethernet Address: 11:22:33:44:55:66
`
	n := ParseHardwarePortsForTest(raw)
	if n != 2 {
		t.Fatalf("期望 2 个端口，得到 %d", n)
	}
}
