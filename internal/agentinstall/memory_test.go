package agentinstall

import (
	"strings"
	"testing"
)

func TestAgentMemoryBudget(t *testing.T) {
	for _, setting := range []string{"MemoryHigh=192M", "MemoryMax=256M", "Environment=GOMEMLIMIT=128MiB"} {
		if !strings.Contains(unitContent, setting+"\n") {
			t.Fatalf("安装模板缺少 %s", setting)
		}
	}
	p := parseProbe(sampleProbe)
	p.MemAvailKB = 255 * 1024
	if p.InstallBlockReason() == "" {
		t.Fatal("可用内存不足 256 MiB 必须阻止安装")
	}
	p.MemAvailKB = 256 * 1024
	if reason := p.InstallBlockReason(); reason != "" {
		t.Fatalf("可用内存达到 256 MiB 应允许安装: %s", reason)
	}
}

func TestSystemdUnitAlwaysOverwritten(t *testing.T) {
	script := systemdUnitWriteScript()
	if !strings.Contains(script, "cat > "+remoteUnit+" <<'UNIT'") {
		t.Fatalf("应无条件覆盖写入 unit: %s", script)
	}
	if strings.Contains(script, "if [ ! -f") {
		t.Fatal("更新时不能因 unit 已存在而跳过覆盖")
	}
	for _, setting := range []string{"MemoryHigh=192M", "MemoryMax=256M", "Environment=GOMEMLIMIT=128MiB"} {
		if !strings.Contains(script, setting+"\n") {
			t.Fatalf("覆盖脚本缺少 %s", setting)
		}
	}
}
