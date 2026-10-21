//go:build linux && cgo && !gtk3 && !android && !server

package app

import "testing"

func TestLinuxPendingSaveName(t *testing.T) {
	setLinuxSaveInitialName("nginx-logs-20261021-110405.tar.zst")
	defer setLinuxSaveInitialName("")
	if got := linuxPendingSaveName(); got != "nginx-logs-20261021-110405.tar.zst" {
		t.Fatalf("pending save name=%q", got)
	}
	setLinuxSaveInitialName("")
	if got := linuxPendingSaveName(); got != "" {
		t.Fatalf("cleared save name=%q", got)
	}
}
