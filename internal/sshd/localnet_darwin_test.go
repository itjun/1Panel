//go:build darwin

package sshd

import (
	"errors"
	"testing"
)

func TestShouldRetryLAN(t *testing.T) {
	err := errors.New("connect: no route to host")
	if !shouldRetryLAN("192.168.50.222:22", err) {
		t.Fatal("局域网无路由应重试")
	}
	if shouldRetryLAN("127.0.0.1:1", err) {
		t.Fatal("回环不应走局域网重试")
	}
	if shouldRetryLAN("1.1.1.1:22", err) {
		t.Fatal("公网不应走局域网重试")
	}
	if shouldRetryLAN("192.168.50.222:22", errors.New("connection refused")) {
		t.Fatal("拒绝连接不应重试")
	}
}
