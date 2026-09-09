package monitor

import (
	"strings"
	"testing"
)

// 模拟 Proxmox：系统装在 ~94GB 的 pve-root，整盘是 2TB NVMe；
// 其余容量在 LVM thin pool（VM 盘），不会出现在 df 里。
const proxmoxDF = `Filesystem           Type     1B-blocks        Used    Available Use% Mounted on
/dev/mapper/pve-root ext4    100663296000 20803747840 75759697920  22% /
/dev/nvme0n1p2       vfat       1071644672     9437184  1062207488   1% /boot/efi
/dev/mapper/pve-data fuse.fuse   134217728       28672   134189056   1% /etc/pve
`

const proxmoxLsblk = `nvme0n1 2000398934016 disk
`

const proxmoxLVS = `  root   -wi-ao---- 100663296000
  swap   -wi-ao----   8589934592
  data   twi-aotz-- 1880000000000 35.00
`

func TestShouldSkipMountEntry_PVEPseudo(t *testing.T) {
	skip := []DiskInfo{
		{Mount: "/sys/firmware/efi/efivars", FSType: "efivarfs"},
		{Mount: "/etc/pve", FSType: "fuse"},
		{Mount: "/var/lib/docker/overlay2/x", FSType: "ext4"},
	}
	for _, d := range skip {
		if !shouldSkipMountEntry(d) {
			t.Fatalf("应跳过 %+v", d)
		}
	}
	keep := DiskInfo{Mount: "/", FSType: "ext4", Total: 100 << 30}
	if shouldSkipMountEntry(keep) {
		t.Fatalf("根分区不应跳过")
	}
}

func TestDiskCollectScript_OptionalCmdsTolerateMissing(t *testing.T) {
	script := diskCollectScript()
	if !strings.Contains(script, "zpool list") || !strings.Contains(script, "zpool list -Hp -o name,size,allocated,free 2>/dev/null || true") {
		t.Fatalf("zpool 必须带 || true，否则无 ZFS 主机 CollectDisks 会 exit 127:\n%s", script)
	}
	if !strings.Contains(script, "lvs --noheadings") || !strings.Contains(script, "2>/dev/null || true") {
		t.Fatalf("lvs 必须带 || true:\n%s", script)
	}
}

func TestParseDisks_ProxmoxDFOnlyLooksLike95G(t *testing.T) {
	mounts := parseDisks(proxmoxDF)
	var total uint64
	for _, d := range mounts {
		total += d.Total
	}
	// 旧口径：只加 df → 约 95GB，远小于 2TB
	if total > 120<<30 {
		t.Fatalf("fixture 应模拟「仅 df 约 95GB」，实际 total=%d", total)
	}
}

func TestMergeDiskInfos_ProxmoxPhysical2T(t *testing.T) {
	out := mergeDiskInfos(proxmoxDF, proxmoxLsblk, proxmoxLVS, "")
	var diskTotal, diskUsed uint64
	var mountCount, diskCount int
	for _, d := range out {
		if d.Kind == "disk" {
			diskCount++
			diskTotal += d.Total
			diskUsed += d.Used
		} else {
			mountCount++
		}
	}
	if diskCount != 1 {
		t.Fatalf("期望 1 块物理盘，实际 %d；out=%+v", diskCount, out)
	}
	// 2TB NVMe
	wantTotal := uint64(2000398934016)
	if diskTotal != wantTotal {
		t.Fatalf("物理盘总量期望 %d，实际 %d", wantTotal, diskTotal)
	}
	// 已用 ≈ df 挂载已用 + thin pool 已用（35% × 1.88TB）
	// 不能再是「只有根分区 ~20GB」
	minUsed := uint64(500 << 30) // 至少约 500GB（thin 35% 已超）
	if diskUsed < minUsed {
		t.Fatalf("物理盘已用过低（未计入 thin pool?）used=%d，期望 ≥ %d", diskUsed, minUsed)
	}
	if mountCount < 2 {
		t.Fatalf("仍应返回挂载分区供列表展示，mountCount=%d", mountCount)
	}
}

func TestMergeDiskInfos_ZFSPreferPool(t *testing.T) {
	df := `Filesystem Type 1B-blocks Used Available Use% Mounted on
rpool/ROOT/pve-1 zfs 2000000000000 50000000000 1950000000000 3% /
`
	lsblk := `nvme0n1 2000398934016 disk
`
	zpool := `rpool	2000398934016	100000000000	1900398934016
`
	out := mergeDiskInfos(df, lsblk, "", zpool)
	var disks []DiskInfo
	for _, d := range out {
		if d.Kind == "disk" {
			disks = append(disks, d)
		}
	}
	if len(disks) != 1 || disks[0].Filesystem != "rpool" {
		t.Fatalf("有 zpool 时应按池展示，实际 %+v", disks)
	}
	if disks[0].Total != 2000398934016 || disks[0].Used != 100000000000 {
		t.Fatalf("zpool 容量不对: %+v", disks[0])
	}
}

func TestParseLsblkDisks(t *testing.T) {
	got := parseLsblkDisks("sda 1000 disk\nsdb 2000 disk\nloop0 100 loop\nsr0 500 rom\n")
	if len(got) != 2 || got[0].Name != "sda" || got[0].Size != 1000 || got[1].Size != 2000 {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestParseLVSThinUsed(t *testing.T) {
	used := parseLVSThinUsed(proxmoxLVS)
	// 1880000000000 * 35 / 100 = 658000000000
	want := uint64(658000000000)
	if used != want {
		t.Fatalf("thin used 期望 %d，实际 %d", want, used)
	}
}
