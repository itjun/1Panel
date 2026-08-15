package monitor

import "testing"

func TestHeapFromArgs(t *testing.T) {
	cases := []struct {
		name    string
		args    string
		xms     uint64
		xmx     uint64
	}{
		{"常规 -Xms/-Xmx 连写", `java -Xms512m -Xmx4g -jar app.jar`, 512 * 1024 * 1024, 4 * 1024 * 1024 * 1024},
		{"无单位（字节）", `java -Xms268435456 -Xmx1073741824 -jar app.jar`, 268435456, 1073741824},
		{"-XX 形式", `java -XX:InitialHeapSize=1g -XX:MaxHeapSize=2G app.Main`, 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024},
		{"只设 Xmx", `java -Xmx1024m -jar app.jar`, 0, 1024 * 1024 * 1024},
		{"未设置", `java -jar app.jar`, 0, 0},
		{"k 单位", `java -Xms64k -Xmx512K app.Main`, 64 * 1024, 512 * 1024},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			xms, xmx := heapFromArgs(c.args)
			if xms != c.xms || xmx != c.xmx {
				t.Fatalf("heapFromArgs(%q) = (%d, %d)，期望 (%d, %d)", c.args, xms, xmx, c.xms, c.xmx)
			}
		})
	}
}
