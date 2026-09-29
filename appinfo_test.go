package main

import (
	"strings"
	"testing"
)

func TestGetAppInfo(t *testing.T) {
	var s System
	info := s.GetAppInfo()
	if info.AppName != "1Panel" {
		t.Fatalf("AppName=%q", info.AppName)
	}
	if info.Version == "" {
		t.Fatal("Version 为空")
	}
	if info.OS == "" || info.Arch == "" {
		t.Fatalf("OS/Arch 为空: %+v", info)
	}
	if !strings.Contains(info.RepoURL, "https://") || !strings.Contains(info.ReleasesURL, "releases") {
		t.Fatalf("链接异常: %+v", info)
	}
	if info.AgentVer == "" {
		t.Fatal("内置 Agent 版本为空")
	}
}

func TestOpenExternalURLSchemeGuard(t *testing.T) {
	var s System
	for _, bad := range []string{"file:///C:/Windows", "cmd://x", "not a url", ""} {
		if err := s.OpenExternalURL(bad); err == nil {
			t.Fatalf("OpenExternalURL(%q) 应拒绝", bad)
		}
	}
}
