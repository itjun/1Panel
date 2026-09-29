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
