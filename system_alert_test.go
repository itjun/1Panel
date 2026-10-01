package main

import (
	"strings"
	"testing"

	"diteng-pannel/internal/wecom"
)

func TestHostAlertMarkdownLevel(t *testing.T) {
	base := HostAlertNotify{
		Host:  "h1",
		Kind:  "cpu",
		State: "down",
		Title: "「h1」CPU 进入警告档",
		Lines: []wecom.Line{{Label: "当前值", Value: "64.0%"}},
	}
	warn := base
	warn.Level = "warn"
	if md := hostAlertMarkdown(warn); !strings.Contains(md, "警告") || strings.Contains(md, "严重") {
		t.Fatalf("warn 档应显示 [警告]：%s", md)
	}
	danger := base
	danger.Level = "danger"
	if md := hostAlertMarkdown(danger); !strings.Contains(md, "严重") {
		t.Fatalf("danger 档应显示 [严重]：%s", md)
	}
}
