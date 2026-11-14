package sshd

import (
	"errors"
	"strings"
	"testing"
)

func TestIsNoRoute(t *testing.T) {
	if isNoRoute(nil) {
		t.Fatal()
	}
	if !isNoRoute(errors.New("dial tcp 192.168.50.222:22: connect: no route to host")) {
		t.Fatal("应识别 no route to host")
	}
	if isNoRoute(errors.New("connection refused")) {
		t.Fatal("拒绝连接不应当成无路由")
	}
}

func TestWrapDialErrKeepsCause(t *testing.T) {
	err := wrapDialErr("192.168.50.222:22", errors.New("connect: no route to host"))
	if err == nil {
		t.Fatal("want error")
	}
	s := err.Error()
	if !strings.Contains(s, "本地网络") || !strings.Contains(s, "192.168.50.222:22") {
		t.Fatalf("文案缺少指引: %s", s)
	}
}
