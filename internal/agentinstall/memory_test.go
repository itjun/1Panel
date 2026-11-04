package agentinstall

import (
	"strings"
	"testing"
)

func TestAgentMemoryBudget(t *testing.T) {
	for _, setting := range []string{"MemoryHigh=96M", "MemoryMax=128M", "Environment=GOMEMLIMIT=64MiB"} {
		if !strings.Contains(unitContent, setting+"\n") {
			t.Fatalf("安装模板缺少 %s", setting)
		}
	}
	p := parseProbe(sampleProbe)
	p.MemAvailKB = 127 * 1024
	if p.InstallBlockReason() == "" {
		t.Fatal("可用内存不足 128 MiB 必须阻止安装")
	}
	p.MemAvailKB = 128 * 1024
	if reason := p.InstallBlockReason(); reason != "" {
		t.Fatalf("可用内存达到 128 MiB 应允许安装: %s", reason)
	}
}
