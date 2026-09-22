package notifysubs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSetGetRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := &Store{
		path: filepath.Join(dir, "notify_subs.json"),
		data: emptyData(),
	}
	if s.Get().FromDisk {
		t.Fatal("empty store should not be FromDisk")
	}

	in := Data{
		NotifyEnabled:        true,
		WecomWebhook:         " https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc ",
		SystemNotifyEnabled:  true,
		InAppNotifyEnabled:   false,
		AlertContentKinds:    []string{"cpu", "mem", "cpu", "", "app", "nope"},
		NotifyRecoverEnabled: true,
		NotifyContentFields:  []string{"hostName", "metric", "hostName", "bad"},
		HostResourceNotifySubs: map[string][]string{
			" diteng-main ": {"cpu", "mem", "cpu"},
			"dev-box":       {},
		},
		HostAppNotifySubs: map[string][]string{
			"diteng-main": {"im", "oss"},
			"cdcp-main":   {},
		},
	}
	if err := s.Set(in); err != nil {
		t.Fatal(err)
	}
	got := s.Get()
	if !got.FromDisk {
		t.Fatal("after Set, FromDisk should be true")
	}
	if !got.NotifyEnabled || got.WecomWebhook != "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc" {
		t.Fatalf("webhook/enabled: %#v", got)
	}
	if !got.SystemNotifyEnabled || got.InAppNotifyEnabled {
		t.Fatalf("channel flags: system=%v inApp=%v", got.SystemNotifyEnabled, got.InAppNotifyEnabled)
	}
	if !got.NotifyRecoverEnabled {
		t.Fatal("recover should stay true")
	}
	if len(got.AlertContentKinds) != 3 {
		t.Fatalf("kinds=%v", got.AlertContentKinds)
	}
	if len(got.NotifyContentFields) != 2 {
		t.Fatalf("fields=%v", got.NotifyContentFields)
	}
	if len(got.HostResourceNotifySubs["diteng-main"]) != 2 {
		t.Fatalf("resource=%v", got.HostResourceNotifySubs)
	}
	if _, ok := got.HostResourceNotifySubs["dev-box"]; ok {
		t.Fatal("empty host list should be dropped")
	}
	if len(got.HostAppNotifySubs["diteng-main"]) != 2 {
		t.Fatalf("app=%v", got.HostAppNotifySubs)
	}
	emptyApp, okEmpty := got.HostAppNotifySubs["cdcp-main"]
	if !okEmpty || emptyApp == nil || len(emptyApp) != 0 {
		t.Fatalf("empty app host should be kept: ok=%v list=%v", okEmpty, emptyApp)
	}

	raw, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	var disk map[string]any
	if err := json.Unmarshal(raw, &disk); err != nil {
		t.Fatal(err)
	}
	if _, ok := disk["wecomAlertKinds"]; ok {
		t.Fatalf("wecomAlertKinds must not be written: %v", disk)
	}

	s2 := &Store{path: s.path, data: emptyData()}
	if err := s2.load(); err != nil {
		t.Fatal(err)
	}
	got2 := s2.Get()
	if !got2.FromDisk {
		t.Fatal("reload should be FromDisk")
	}
	if got2.HostAppNotifySubs["diteng-main"][0] != "im" {
		t.Fatalf("reload app=%v", got2.HostAppNotifySubs)
	}
	empty2, ok2 := got2.HostAppNotifySubs["cdcp-main"]
	if !ok2 || len(empty2) != 0 {
		t.Fatalf("reload should keep empty app host: ok=%v list=%v", ok2, empty2)
	}
	if got2.InAppNotifyEnabled {
		t.Fatal("reload should keep inAppNotifyEnabled=false")
	}
	_ = os.Remove(s.path)
}

func TestMissingFileNotFromDisk(t *testing.T) {
	s := &Store{
		path: filepath.Join(t.TempDir(), "missing.json"),
		data: emptyData(),
	}
	if err := s.load(); err != nil {
		t.Fatal(err)
	}
	if s.Get().FromDisk {
		t.Fatal("missing file is not FromDisk")
	}
	got := s.Get()
	if !got.SystemNotifyEnabled || !got.InAppNotifyEnabled || !got.NotifyRecoverEnabled {
		t.Fatalf("empty defaults should keep channels/recover on: %#v", got)
	}
	if len(got.AlertContentKinds) != 6 || len(got.NotifyContentFields) != 5 {
		t.Fatalf("empty defaults kinds=%v fields=%v", got.AlertContentKinds, got.NotifyContentFields)
	}
	if !got.CertKindMigrated || !containsKind(got.AlertContentKinds, "cert") {
		t.Fatalf("empty defaults should include cert: %#v", got.AlertContentKinds)
	}
}

func TestMigrateWecomAlertKinds(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notify_subs.json")
	legacy := map[string]any{
		"notifyEnabled":   true,
		"wecomWebhook":    "https://example/hook",
		"wecomAlertKinds": []string{"cpu", "disk", "cpu", "bogus"},
		"hostResourceNotifySubs": map[string][]string{
			"h1": {"cpu"},
		},
		"hostAppNotifySubs": map[string][]string{},
	}
	b, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0644); err != nil {
		t.Fatal(err)
	}

	s := &Store{path: path, data: emptyData()}
	if err := s.load(); err != nil {
		t.Fatal(err)
	}
	got := s.Get()
	if !got.SystemNotifyEnabled || !got.InAppNotifyEnabled || !got.NotifyRecoverEnabled {
		t.Fatalf("legacy missing bools default true: %#v", got)
	}
	wantKinds := []string{"cpu", "disk", "app", "cert"}
	if len(got.AlertContentKinds) != len(wantKinds) {
		t.Fatalf("migrated kinds=%v want %v", got.AlertContentKinds, wantKinds)
	}
	for i, k := range wantKinds {
		if got.AlertContentKinds[i] != k {
			t.Fatalf("migrated kinds=%v want %v", got.AlertContentKinds, wantKinds)
		}
	}
	if len(got.NotifyContentFields) != 5 {
		t.Fatalf("fields default all: %v", got.NotifyContentFields)
	}

	if err := s.Set(got); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var disk map[string]any
	if err := json.Unmarshal(raw, &disk); err != nil {
		t.Fatal(err)
	}
	if _, ok := disk["wecomAlertKinds"]; ok {
		t.Fatal("rewrite must drop wecomAlertKinds")
	}
}

func TestExplicitEmptyAlertContentKinds(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notify_subs.json")
	body := `{"alertContentKinds":[],"notifyContentFields":[],"systemNotifyEnabled":false}`
	if err := os.WriteFile(path, []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
	s := &Store{path: path, data: emptyData()}
	if err := s.load(); err != nil {
		t.Fatal(err)
	}
	got := s.Get()
	if got.SystemNotifyEnabled {
		t.Fatal("explicit false must stick")
	}
	if len(got.AlertContentKinds) != 1 || got.AlertContentKinds[0] != "cert" || !got.CertKindMigrated {
		t.Fatalf("first load of an old file should turn cert on once: %#v migrated=%v", got.AlertContentKinds, got.CertKindMigrated)
	}
	if len(got.NotifyContentFields) != 0 {
		t.Fatalf("explicit empty fields must stick: %v", got.NotifyContentFields)
	}
	if !got.InAppNotifyEnabled || !got.NotifyRecoverEnabled {
		t.Fatalf("missing bools still default true: %#v", got)
	}

	// 用户之后关掉证书：迁移标记已写下，再加载不能把证书加回来。
	got.AlertContentKinds = []string{}
	if err := s.Set(got); err != nil {
		t.Fatal(err)
	}
	s2 := &Store{path: path, data: emptyData()}
	if err := s2.load(); err != nil {
		t.Fatal(err)
	}
	if len(s2.Get().AlertContentKinds) != 0 {
		t.Fatalf("cert off must stick after migration: %v", s2.Get().AlertContentKinds)
	}
}
