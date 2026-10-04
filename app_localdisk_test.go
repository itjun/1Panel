package main

import (
	"strings"
	"testing"

	"diteng-pannel/internal/localsys"
)

const gib = uint64(1) << 30

func volume(mount string, total, used, avail uint64, pct float64, external bool) localsys.DiskInfo {
	return localsys.DiskInfo{
		Mount: mount, Device: mount, Filesystem: mount,
		Total: total, Used: used, Free: avail, Avail: avail,
		Percent: pct, Kind: "mount", External: external,
	}
}

func TestEvaluateLocalDisk(t *testing.T) {
	cases := []struct {
		name    string
		disks   []localsys.DiskInfo
		want    []string // 每块超线分区的 "mount:level"，按严重度降序
		byAvail map[string]bool
	}{
		{
			name:  "全部健康",
			disks: []localsys.DiskInfo{volume(`C:\`, 500*gib, 200*gib, 300*gib, 40, false)},
			want:  nil,
		},
		{
			name: "危险档",
			disks: []localsys.DiskInfo{
				volume(`C:\`, 930*gib, 904*gib, 26*gib, 97.1, false),
			},
			want: []string{`C:\:danger`},
		},
		{
			name: "预警档含边界",
			disks: []localsys.DiskInfo{
				volume(`C:\`, 500*gib, 300*gib, 200*gib, 60, false),  // 恰好 60% → 预警
				volume(`D:\`, 500*gib, 424*gib, 76*gib, 84.8, false), // 差 0.2 到危险线 → 预警
			},
			want: []string{`D:\:warn`, `C:\:warn`}, // 同档按使用率降序
		},
		{
			name: "危险优先于预警排序",
			disks: []localsys.DiskInfo{
				volume(`C:\`, 500*gib, 350*gib, 150*gib, 70, false),
				volume(`D:\`, 500*gib, 440*gib, 60*gib, 88, false),
			},
			want: []string{`D:\:danger`, `C:\:warn`},
		},
		{
			name: "小分区与可移动盘不参与",
			disks: []localsys.DiskInfo{
				volume(`<EFI>`, 8*gib, 7*gib, 1*gib, 87.5, false),   // < 10 GB
				volume(`E:\`, 64*gib, 63*gib, 1*gib, 98.4, true),    // U 盘
				volume(`C:\`, 500*gib, 200*gib, 300*gib, 40, false), // 健康
			},
			want: nil,
		},
		{
			name: "disk+mount 重复记录只算一次",
			disks: []localsys.DiskInfo{
				{Mount: `C:\`, Total: 500 * gib, Used: 460 * gib, Avail: 40 * gib, Percent: 92, Kind: "disk"},
				{Mount: `C:\`, Total: 500 * gib, Used: 460 * gib, Avail: 40 * gib, Percent: 92, Kind: "mount"},
			},
			want: []string{`C:\:danger`},
		},
		{
			name: "只有物理盘记录时退回物理盘",
			disks: []localsys.DiskInfo{
				{Mount: `C:\`, Total: 500 * gib, Used: 460 * gib, Avail: 40 * gib, Percent: 92, Kind: "disk"},
			},
			want: []string{`C:\:danger`},
		},
		{
			name: "可用空间极低时按可用口径",
			disks: []localsys.DiskInfo{
				// 使用率 99.6%，可用 2 GB 折算严重度 105 > 99.6 → 取可用条件的读数
				volume(`C:\`, 500*gib, 498*gib, 2*gib, 99.6, false),
			},
			want:    []string{`C:\:danger`},
			byAvail: map[string]bool{`C:\`: true},
		},
		{
			name: "大分区可用偏低取更差档",
			disks: []localsys.DiskInfo{
				// 使用率 80% 预警、可用 15 GB 预警，同档比较严重度：55 < 80 → 仍按使用率
				volume(`C:\`, 100*gib, 80*gib, 15*gib, 80, false),
				// 使用率 79.5% 预警、可用 19 GB 折算 62.5 < 79.5 → 按使用率
				volume(`D:\`, 200*gib, 159*gib, 41*gib, 79.5, false),
			},
			want: []string{`C:\:warn`, `D:\:warn`},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := evaluateLocalDisk(tc.disks)
			if len(got) != len(tc.want) {
				t.Fatalf("超线分区数 = %d, want %d（结果 %+v）", len(got), len(tc.want), got)
			}
			for i, b := range got {
				key := b.Mount + ":" + b.Level
				if key != tc.want[i] {
					t.Errorf("第 %d 块 = %s, want %s", i, key, tc.want[i])
				}
				if tc.byAvail != nil && b.ByAvail != tc.byAvail[b.Mount] {
					t.Errorf("%s ByAvail = %v, want %v", b.Mount, b.ByAvail, tc.byAvail[b.Mount])
				}
			}
		})
	}
}

func TestLocalDiskBreachText(t *testing.T) {
	// 「已用 97.1%」的写法被前端 usagePercent 解析画占用条，格式不能变
	got := localDiskBreachText(localDiskBreach{Mount: `C:\`, Avail: 26 * gib, Percent: 97.1, Level: "danger"})
	if !strings.Contains(got, `C:\ 已用 97.1%（可用 26 GB）`) {
		t.Fatalf("使用率口径文案不符: %s", got)
	}
	got = localDiskBreachText(localDiskBreach{Mount: `C:\`, Avail: 2 * gib, Percent: 99.6, Level: "danger", ByAvail: true})
	if !strings.Contains(got, `C:\ 可用 2 GB（已用 99.6%）`) {
		t.Fatalf("可用口径文案不符: %s", got)
	}
	if s := localDiskThresholdText("danger"); s != "危险 使用率 ≥ 85% 或可用 ≤ 10 GB" {
		t.Fatalf("危险阈值文案不符: %s", s)
	}
	if s := localDiskThresholdText("warn"); s != "警告 使用率 ≥ 60% 或可用 ≤ 20 GB" {
		t.Fatalf("警告阈值文案不符: %s", s)
	}
}

func TestFormatDiskBytes(t *testing.T) {
	cases := []struct {
		in   uint64
		want string
	}{
		{0, "0 B"},
		{512, "512 B"},
		{24 * gib, "24 GB"}, // 末尾 .0 去掉，对齐前端 parseFloat
		{26*gib + 600*1024*1024, "26.6 GB"},
		{1536 * gib, "1.5 TB"},
	}
	for _, tc := range cases {
		if got := formatDiskBytes(tc.in); got != tc.want {
			t.Errorf("formatDiskBytes(%d) = %s, want %s", tc.in, got, tc.want)
		}
	}
}
