package agentcli

import (
	"errors"
	"testing"
)

func item(r CheckReport, key string) CheckItem {
	for _, it := range r.Items {
		if it.Key == key {
			return it
		}
	}
	return CheckItem{Key: key, Detail: "missing"}
}

func TestBuildCheckReportHealthy(t *testing.T) {
	r := BuildCheckReport(CheckInput{
		PanelVersion: "0.2.24",
		HasBinary:    true,
		ServiceState: "active",
		Health: Health{
			Version:   "0.2.24",
			UptimeSec: 82,
			RSSKB:     8192,
			Written:   12,
		},
	})
	if !r.OK {
		t.Fatalf("want ok, summary=%s items=%v", r.Summary, r.Items)
	}
	if it := item(r, "collect"); !it.OK || it.Detail != "已写入 12 条" {
		t.Fatalf("collect=%+v", it)
	}
	if it := item(r, "version"); !it.OK {
		t.Fatalf("version=%+v", it)
	}
}

func TestBuildCheckReportNoSamples(t *testing.T) {
	r := BuildCheckReport(CheckInput{
		PanelVersion: "0.2.24",
		HasBinary:    true,
		ServiceState: "active",
		Health: Health{
			Version:   "0.2.24",
			UptimeSec: 3,
			Written:   0,
		},
		CurrentErr: errors.New("agent: 尚无采样数据，请稍候"),
	})
	if r.OK {
		t.Fatal("no samples should not be ok")
	}
	it := item(r, "collect")
	if it.OK || it.Detail != "尚无采样（已写入 0 条）" {
		t.Fatalf("collect=%+v", it)
	}
	if it := item(r, "comm"); !it.OK {
		t.Fatalf("comm should still pass: %+v", it)
	}
}

func TestBuildCheckReportVersionMismatchAndDiskLow(t *testing.T) {
	r := BuildCheckReport(CheckInput{
		PanelVersion: "0.2.24",
		HasBinary:    true,
		ServiceState: "active",
		Health: Health{
			Version: "0.2.20",
			Written: 4,
			DiskLow: true,
		},
	})
	if r.OK {
		t.Fatal("want fail")
	}
	if it := item(r, "version"); it.OK {
		t.Fatalf("version should fail: %+v", it)
	}
	if it := item(r, "disk"); it.OK {
		t.Fatalf("disk should fail: %+v", it)
	}
	if it := item(r, "collect"); it.OK {
		t.Fatalf("collect should fail when disk low: %+v", it)
	}
}

func TestIsNoSampleData(t *testing.T) {
	if IsNoSampleData(nil) {
		t.Fatal("nil")
	}
	if !IsNoSampleData(errors.New("agent: 尚无采样数据，请稍候")) {
		t.Fatal("want match")
	}
	if IsNoSampleData(errors.New("agent 不可达")) {
		t.Fatal("other error")
	}
}
