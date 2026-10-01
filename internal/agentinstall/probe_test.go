package agentinstall

import (
	"strings"
	"testing"
)

const sampleProbe = `=OS=Linux
=ARCH=x86_64
=UID=0
=SYSTEMD=1
=BIN=1
=WR_BIN=1
=WR_TMP=1
=SVC=active
=DATA_TOTAL_KB=20971520
=DATA_AVAIL_KB=2500000
=DATA_MNT=/
=TMP_AVAIL_KB=2500000
=BIN_AVAIL_KB=2500000
=MEM_AVAIL_KB=2097152
=MEM_TOTAL_KB=3653632
`

func TestParseProbe(t *testing.T) {
	p := parseProbe(sampleProbe)
	if p.OS != "Linux" || p.Arch != "x86_64" || !p.HasSystemd || !p.HasBinary {
		t.Fatalf("basic: %+v", p)
	}
	if p.ServiceState != "active" || p.UID != 0 {
		t.Fatalf("svc/uid: %+v", p)
	}
	if p.DataMount != "/" || p.DataTotalKB != 20971520 || p.DataAvailKB != 2500000 {
		t.Fatalf("disk: %+v", p)
	}
	if p.InstallBlockReason() != "" {
		t.Fatalf("want allow, got %q", p.InstallBlockReason())
	}
}

func TestBlockDiskBelowWatermark(t *testing.T) {
	p := parseProbe(sampleProbe)
	// 20GB 盘剩余 3.2%（约 655360 KB）< 5%
	p.DataAvailKB = 655360
	got := p.InstallBlockReason()
	if got == "" || !strings.Contains(got, "低于采集停写水位") {
		t.Fatalf("got %q", got)
	}
	if !strings.Contains(got, "请先清理磁盘") {
		t.Fatalf("want cleanup hint, got %q", got)
	}
}

func TestNoSystemdAllowedButNotLinuxBlocked(t *testing.T) {
	p := ProbeInfo{OS: "Linux", HasSystemd: false, WritableBin: false, WritableTmp: true}
	if got := p.InstallBlockReason(); got != "" {
		t.Fatalf("无 systemd / bin 不可写应允许安装，got %q", got)
	}
	p = ProbeInfo{OS: "Darwin", HasSystemd: true, WritableBin: true, WritableTmp: true}
	if !strings.Contains(p.InstallBlockReason(), "仅支持 Linux") {
		t.Fatalf("got %q", p.InstallBlockReason())
	}
}

func TestBlockTmpAndMem(t *testing.T) {
	p := parseProbe(sampleProbe)
	p.TmpAvailKB = 8 * 1024
	if !strings.Contains(p.InstallBlockReason(), "/tmp") {
		t.Fatalf("tmp: %q", p.InstallBlockReason())
	}
	p = parseProbe(sampleProbe)
	p.MemAvailKB = 32 * 1024
	if !strings.Contains(p.InstallBlockReason(), "内存") {
		t.Fatalf("mem: %q", p.InstallBlockReason())
	}
}

func TestParseInitMode(t *testing.T) {
	p := parseProbe("=OS=Linux\n=INIT=systemd\n")
	if p.InitMode != InitSystemd || p.HasCron || p.HasOpenRC {
		t.Fatalf("systemd: %+v", p)
	}
	p = parseProbe("=OS=Linux\n=INIT=supervisor\n=CRON=1\n=OPENRC=1\n=SVC=inactive\n")
	if p.InitMode != InitSupervisor || !p.HasCron || !p.HasOpenRC || p.ServiceState != "inactive" {
		t.Fatalf("supervisor: %+v", p)
	}
	// 老探测输出没有 INIT 行时按守护方式处理
	if p = parseProbe("=OS=Linux\n"); p.InitMode != InitSupervisor {
		t.Fatalf("default: %+v", p)
	}
}

func TestRootImpliesWritable(t *testing.T) {
	p := parseProbe("=UID=0\n=OS=Linux\n=SYSTEMD=1\n=WR_BIN=0\n=WR_TMP=0\n")
	if !p.WritableBin || !p.WritableTmp {
		t.Fatalf("root should be treated writable: %+v", p)
	}
}
