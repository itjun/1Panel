//go:build darwin

package localsys

import (
	"os"
	"testing"
)

const fixtureAPFSList = `
APFS Containers (5 found)
|
+-- Container disk3 B407FC5C
|   ====================================================
|   APFS Container Reference:     disk3
|   Size (Capacity Ceiling):      494384795648 B (494.4 GB)
|   Capacity In Use By Volumes:   414647185408 B (414.6 GB) (83.9% used)
|   Capacity Not Allocated:       79737610240 B (79.7 GB) (16.1% free)
|   |
|   +-< Physical Store disk0s2 5A4EA38C
|   |   -----------------------------------------------------------
|   |   APFS Physical Store Disk:   disk0s2
|   |   Size:                       494384795648 B (494.4 GB)
|   |
|   +-> Volume disk3s1 37E32BB5
|   |   ---------------------------------------------------
|   |   APFS Volume Disk (Role):   disk3s1 (System)
|   |   Name:                      Macintosh HD (Case-insensitive)
|   |   Mount Point:               Not Mounted
|   |
|   +-> Volume disk3s5 9B545382
|       ---------------------------------------------------
|       APFS Volume Disk (Role):   disk3s5 (Data)
|       Name:                      Data (Case-insensitive)
|       Mount Point:               /System/Volumes/Data
|
+-- Container disk5 5C779540
|   ====================================================
|   APFS Container Reference:     disk5
|   Size (Capacity Ceiling):      18559795200 B (18.6 GB)
|   Capacity In Use By Volumes:   18056196096 B (18.1 GB) (97.3% used)
|   Capacity Not Allocated:       503599104 B (503.6 MB) (2.7% free)
|   |
|   +-< Physical Store disk4s1 32B95CEA
|   |   APFS Physical Store Disk:   disk4s1
|   |
|   +-> Volume disk5s1 C0B81AA8
|       APFS Volume Disk (Role):   disk5s1 (No specific role)
|       Name:                      iOS 27.0 Simulator (Case-insensitive)
|
+-- Container disk7 518AC890
    ====================================================
    APFS Container Reference:     disk7
    Size (Capacity Ceiling):      3296722944 B (3.3 GB)
    Capacity In Use By Volumes:   3186352128 B (3.2 GB) (96.7% used)
    Capacity Not Allocated:       110370816 B (110.4 MB) (3.3% free)
    |
    +-< Physical Store disk6s1 65B9C5F3
    |   APFS Physical Store Disk:   disk6s1
    |
    +-> Volume disk7s1 86407289
        APFS Volume Disk (Role):   disk7s1 (No specific role)
        Name:                      MetalToolchainCryptex (Case-insensitive)
`

const fixtureDiskutilList = `/dev/disk0 (internal, physical):
   #:                       TYPE NAME                    SIZE       IDENTIFIER
   0:      GUID_partition_scheme                        *500.3 GB   disk0

/dev/disk3 (synthesized):
   0:      APFS Container Scheme -                      +494.4 GB   disk3

/dev/disk4 (disk image):
   0:      GUID_partition_scheme                        +18.6 GB    disk4

/dev/disk5 (synthesized):
/dev/disk6 (disk image):
/dev/disk7 (synthesized):
/dev/disk8 (external, physical):
   1:       Microsoft Basic Data USB                    64.0 GB    disk8s1
/dev/disk9 (disk image):
   1:                  Apple_HFS Installer              1.0 GB     disk9s1
`

func fixtureMount(device, mount string, total, used, avail uint64) DiskInfo {
	return DiskInfo{
		Mount: mount, Device: device, Filesystem: device, FSType: "apfs",
		Total: total, Used: used, Free: avail, Avail: avail,
		Kind: "mount", Parent: DiskParentKey(device, mount),
	}
}

func TestBuildLocalDisksOnePhysical(t *testing.T) {
	containers := ParseAPFSContainers(fixtureAPFSList)
	kinds := ParseDiskutilListKinds(fixtureDiskutilList)
	if kinds["disk0"] != "internal, physical" || kinds["disk6"] != "disk image" {
		t.Fatalf("kinds 解析: %v", kinds)
	}
	const gb = 1 << 30
	usb := fixtureMount("/dev/disk8s1", "/Volumes/USB", 64*gb, 10*gb, 54*gb)
	usb.FSType = "volume"
	dmg := fixtureMount("/dev/disk9s1", "/Volumes/Installer", 1*gb, 1*gb, 0)
	dmg.FSType = "volume"
	mounts := []DiskInfo{
		fixtureMount("/dev/disk3s1s1", "/", 460*gb, 13*gb, 74*gb),
		fixtureMount("/dev/disk3s5", "/System/Volumes/Data", 460*gb, 355*gb, 74*gb),
		fixtureMount("/dev/disk3s3", "/Volumes/Recovery", 460*gb, 1*gb, 74*gb),
		fixtureMount("/dev/disk5s1", "/Library/Developer/CoreSimulator/Volumes/iOS_24A434", 17*gb, 16*gb, 1*gb),
		fixtureMount("/dev/disk7s1", "/private/var/run/com.apple.security.cryptexd/mnt/x", 3*gb, 3*gb, 0),
		usb,
		dmg,
	}
	got := BuildLocalDisks(containers, mounts, kinds)

	var phys, parts []DiskInfo
	for _, d := range got {
		if d.Kind == "disk" {
			phys = append(phys, d)
		} else {
			parts = append(parts, d)
		}
	}
	if len(phys) != 2 {
		t.Fatalf("期望 2 块物理盘（内置 disk0 + USB disk8），得到 %+v", phys)
	}
	if phys[0].Device != "disk0" || phys[0].External || phys[0].Total != 494384795648 || phys[0].Used != 414647185408 {
		t.Fatalf("内置盘: %+v", phys[0])
	}
	if phys[1].Device != "disk8" || !phys[1].External || phys[1].Name != "USB" {
		t.Fatalf("外置盘: %+v", phys[1])
	}
	if len(parts) != 3 {
		t.Fatalf("期望 3 个分区（/、USB、Installer），得到 %+v", parts)
	}
	root := parts[0]
	if root.Mount != "/" || root.Name != "Macintosh HD" || root.Used != 414647185408 || root.Parent != "disk0" {
		t.Fatalf("根分区应合并容器: %+v", root)
	}
	if parts[2].FSType != "磁盘映像" || parts[2].External {
		t.Fatalf("dmg 应标为磁盘映像: %+v", parts[2])
	}
}

// LOCALSYS_LIVE=1 go test -run TestLiveListDisks -v ./internal/localsys
func TestLiveListDisks(t *testing.T) {
	if os.Getenv("LOCALSYS_LIVE") == "" {
		t.Skip("设置 LOCALSYS_LIVE=1 读取本机磁盘")
	}
	for _, d := range listDisks() {
		t.Logf("%-5s %-8s name=%-14q mount=%-12q dev=%-16s type=%-6s total=%.1fGiB used=%.1fGiB avail=%.1fGiB pct=%.1f%% external=%v",
			d.Kind, d.Parent, d.Name, d.Mount, d.Device, d.FSType,
			float64(d.Total)/(1<<30), float64(d.Used)/(1<<30), float64(d.Avail)/(1<<30), d.Percent, d.External)
	}
	total, used, avail := apfsContainerSummary()
	t.Logf("磁盘空间页容器: total=%.1fGiB used=%.1fGiB avail=%.1fGiB", float64(total)/(1<<30), float64(used)/(1<<30), float64(avail)/(1<<30))
}
