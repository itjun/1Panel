//go:build linux

package localsys

import (
	"strings"
	"testing"
)

func TestParseProcNetRoute(t *testing.T) {
	raw := `Iface	Destination	Gateway 	Flags	RefCnt	Use	Metric	Mask	MTU	Window	IRTT
wlan0	00000000	0102A8C0	0003	0	0	0	600	00000000	0	0	0
wlan0	00000000	0A00A8C0	0003	0	0	100	00000000	0	0	0
eth9	00000000	0A0A0A0A	0003	0	0	600	00000000	0	0	0
wlan0	00FCAC1A	00000000	0001	0	0	0	FFFFFFFF	0	0	0
`
	gw, iface := ParseProcNetRoute(raw)
	if gw != "192.168.2.1" || iface != "wlan0" {
		t.Fatalf("got gateway=%q iface=%q, want 192.168.2.1/wlan0", gw, iface)
	}

	// 无默认路由
	gw, iface = ParseProcNetRoute("Iface\tDestination\nwlan0\t00FCAC1A\t00000000\t0001\t0\t0\t0\tFFFFFFFF\t0\t0\t0\n")
	if gw != "" || iface != "" {
		t.Fatalf("无默认路由时应为空，得到 %q/%q", gw, iface)
	}
}

func TestParseOSRelease(t *testing.T) {
	raw := `NAME="Debian GNU/Linux"
VERSION_ID="13"
PRETTY_NAME="Debian GNU/Linux 13 (trixie)"
ID=debian
# 注释行
HOME_URL='https://www.debian.org/'
`
	rel := ParseOSRelease(raw)
	if rel["NAME"] != "Debian GNU/Linux" {
		t.Fatalf("NAME=%q", rel["NAME"])
	}
	if rel["VERSION_ID"] != "13" {
		t.Fatalf("VERSION_ID=%q", rel["VERSION_ID"])
	}
	if rel["PRETTY_NAME"] != "Debian GNU/Linux 13 (trixie)" {
		t.Fatalf("PRETTY_NAME=%q", rel["PRETTY_NAME"])
	}
	if rel["ID"] != "debian" {
		t.Fatalf("ID=%q", rel["ID"])
	}
}

func TestParseDesktopEntry(t *testing.T) {
	raw := `[Desktop Entry]
Type=Application
Name=Visual Studio Code
Name[zh_CN]=代码编辑器
Exec=/usr/share/code/code %F
Icon=code
Terminal=false
NoDisplay=false

[Desktop Action New Window]
Name=New Window
`
	e := ParseDesktopEntry(raw)
	if e.Name != "Visual Studio Code" || e.NameZhCN != "代码编辑器" {
		t.Fatalf("Name=%q zh=%q", e.Name, e.NameZhCN)
	}
	if e.NoDisplay {
		t.Fatal("NoDisplay 应为 false")
	}
	if !strings.HasPrefix(e.Exec, "/usr/share/code/code") {
		t.Fatalf("Exec=%q", e.Exec)
	}

	e = ParseDesktopEntry("[Desktop Entry]\nName=Hidden\nNoDisplay=true\n")
	if !e.NoDisplay {
		t.Fatal("NoDisplay=true 应解析")
	}
}

func TestPartitionBoundary(t *testing.T) {
	cases := []struct {
		rest string
		want bool
	}{
		{"1", true}, {"12", true}, // sda1
		{"p1", true}, {"p12", true}, // nvme0n1p1
		{"a1", false}, {"p", false}, // sdap1 不是 sda 的分区
		{"", false}, {"px", false},
	}
	for _, tc := range cases {
		if got := partitionBoundary(tc.rest); got != tc.want {
			t.Fatalf("partitionBoundary(%q)=%v want %v", tc.rest, got, tc.want)
		}
	}
}

func TestLinuxBlockParent(t *testing.T) {
	blocks := []linuxBlock{
		{Name: "sda"}, {Name: "sdap"}, {Name: "nvme0n1"},
	}
	cases := []struct {
		devBase string
		want    string
	}{
		{"sda1", "sda"},
		{"sdap1", "sdap"},        // 最长匹配，不能归到 sda
		{"nvme0n1p3", "nvme0n1"}, // p+数字边界
		{"nvme0n1", "nvme0n1"},   // 自身即整盘
		{"xyz0", ""},             // 未知设备
	}
	for _, tc := range cases {
		if got := linuxBlockParent(blocks, tc.devBase); got != tc.want {
			t.Fatalf("linuxBlockParent(%q)=%q want %q", tc.devBase, got, tc.want)
		}
	}
}

func TestSkipNetDevLinux(t *testing.T) {
	for _, name := range []string{"lo", "veth1234", "docker0", "br-abc", "wg0", "tun0", "tailscale0"} {
		if !skipNetDevLinux(name) {
			t.Fatalf("%s 应跳过", name)
		}
	}
	for _, name := range []string{"eth0", "enp3s0", "wlan0"} {
		if skipNetDevLinux(name) {
			t.Fatalf("%s 不应跳过", name)
		}
	}
}

func TestFormatMacAddr(t *testing.T) {
	if got := formatMacAddr("AA:BB:CC:DD:EE:FF"); got != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("got %q", got)
	}
	if got := formatMacAddr(""); got != "" {
		t.Fatalf("空 MAC 应返回空，得到 %q", got)
	}
}

// ---- 实机 smoke：验证 Linux 采集器在真实系统上返回合理数据 ----

func TestCollectOverviewLinux(t *testing.T) {
	o, err := CollectOverview()
	if err != nil {
		t.Fatalf("CollectOverview: %v", err)
	}
	if o.CPUCount <= 0 {
		t.Fatalf("CPUCount=%d", o.CPUCount)
	}
	if o.CPUModel == "" {
		t.Fatal("CPUModel 为空")
	}
	if o.MemTotal < 1<<30 {
		t.Fatalf("MemTotal=%d 异常", o.MemTotal)
	}
	if o.MemUsed == 0 || o.MemUsed > o.MemTotal {
		t.Fatalf("MemUsed=%d / Total=%d 异常", o.MemUsed, o.MemTotal)
	}
	if o.Kernel == "" || o.OSRelease == "" {
		t.Fatalf("Kernel=%q OSRelease=%q 不应为空", o.Kernel, o.OSRelease)
	}
	if o.ProductName == "" {
		t.Fatal("ProductName（os-release NAME）为空")
	}
	if o.CPUPercent < 0 || o.CPUPercent > 100 {
		t.Fatalf("CPUPercent=%v 越界", o.CPUPercent)
	}
	if o.CPUCount > 0 && len(o.CPUCores) != o.CPUCount {
		t.Fatalf("每核使用率数量 %d 与核数 %d 不符", len(o.CPUCores), o.CPUCount)
	}
	t.Logf("os=%q kernel=%q disks=%d netRx=%d", o.OSRelease, o.Kernel, len(o.Disks), o.NetRxBytes)
}

func TestCollectNetworkLinux(t *testing.T) {
	snap, err := CollectNetwork()
	if err != nil {
		t.Fatalf("CollectNetwork: %v", err)
	}
	if len(snap.Interfaces) == 0 {
		t.Fatal("无网卡")
	}
	for _, ifc := range snap.Interfaces {
		if ifc.Name == "lo" {
			t.Fatal("环回口不应出现")
		}
	}
	// 至少能识别出主网卡（有默认路由的系统）
	if snap.PrimaryIface != "" {
		found := false
		for _, ifc := range snap.Interfaces {
			if ifc.Name == snap.PrimaryIface {
				found = true
			}
		}
		if !found {
			t.Fatalf("主网卡 %s 不在列表中", snap.PrimaryIface)
		}
	}
	t.Logf("ifaces=%d gw=%q primary=%q", len(snap.Interfaces), snap.DefaultGateway, snap.PrimaryIface)
}

func TestCollectNginxLinux(t *testing.T) {
	info, err := CollectNginx()
	if err != nil {
		t.Fatalf("CollectNginx: %v", err)
	}
	// 未安装 nginx 的机器上应优雅返回 Installed=false 而非报错
	if info.Installed {
		if info.Version == "" || info.ConfPath == "" {
			t.Fatalf("已安装但信息不全: %+v", info)
		}
	}
}
