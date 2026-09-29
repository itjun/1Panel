//go:build windows

package main

import (
	"strings"
	"testing"
)

func TestNormalizeTerminalHosts(t *testing.T) {
	got := normalizeTerminalHosts([]string{" alpha ", "be ta", "ok-host_1.2", "", "bad\nhost", "bad;cmd"})
	want := []string{"alpha", "ok-host_1.2"}
	if len(got) != len(want) {
		t.Fatalf("got %q want %q", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %q want %q", got, want)
		}
	}
}

func TestBuildWTArgs(t *testing.T) {
	ssh := `C:\Windows\System32\OpenSSH\ssh.exe`
	tab := buildWTArgs(ssh, []string{"a", "b"}, "tab")
	want := []string{"-w", "0", "new-tab", "--title", "a", ssh, "a", ";", "new-tab", "--title", "b", ssh, "b"}
	if strings.Join(tab, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("tab args:\n got %q\nwant %q", tab, want)
	}
	win := buildWTArgs(ssh, []string{"a"}, "window")
	wantWin := []string{"new-tab", "--title", "a", ssh, "a"}
	if strings.Join(win, "\x00") != strings.Join(wantWin, "\x00") {
		t.Fatalf("window args:\n got %q\nwant %q", win, wantWin)
	}
}

func TestEncodePowerShellCommand(t *testing.T) {
	// -EncodedCommand 是 Base64(UTF-16LE)：脚本 "ab" 应编码为 YQBiA
	if got := encodePowerShellCommand("ab"); got != "YQBiAA==" {
		t.Fatalf("got %q", got)
	}
	if got := encodePowerShellCommand("& 'C:\\x\\ssh.exe' 'ho st'"); got == "" {
		t.Fatal("空编码")
	}
}

func TestOpenHostsInTerminalWindowsNoHost(t *testing.T) {
	if err := openHostsInTerminalWindows([]string{"  "}, "tab"); err == nil {
		t.Fatal("空主机应报错")
	}
}
