package notifysubs

import (
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
		NotifyEnabled:   true,
		WecomWebhook:    " https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc ",
		WecomAlertKinds: []string{"cpu", "mem", "cpu", ""},
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
	if len(got.WecomAlertKinds) != 2 {
		t.Fatalf("kinds=%v", got.WecomAlertKinds)
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
}
