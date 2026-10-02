//go:build linux

package main

import (
	"strings"
	"testing"
)

func TestSpecForBinary(t *testing.T) {
	cases := []struct {
		bin         string
		wantCmdArgs []string
	}{
		{bin: "gnome-terminal", wantCmdArgs: []string{"--"}},
		{bin: "xfce4-terminal", wantCmdArgs: []string{"-x"}},
		{bin: "konsole", wantCmdArgs: []string{"-e"}},
		{bin: "kitty", wantCmdArgs: nil},
		{bin: "wezterm", wantCmdArgs: []string{"start", "--"}},
		{bin: "some-unknown-term", wantCmdArgs: []string{"-e"}},
	}
	for _, c := range cases {
		spec := specForBinary(c.bin)
		if strings.Join(spec.cmdArgs, "\x00") != strings.Join(c.wantCmdArgs, "\x00") {
			t.Fatalf("specForBinary(%q).cmdArgs = %q, want %q", c.bin, spec.cmdArgs, c.wantCmdArgs)
		}
		if spec.bin != c.bin {
			t.Fatalf("specForBinary(%q).bin = %q", c.bin, spec.bin)
		}
	}
}

func TestBuildLinuxTerminalArgs(t *testing.T) {
	ssh := "/usr/bin/ssh"
	cases := []struct {
		name string
		spec linuxTerminalSpec
		mode string
		want string
	}{
		{
			name: "gnome tab",
			spec: specForBinary("gnome-terminal"),
			mode: "tab",
			want: "--tab\x00--\x00/usr/bin/ssh\x00alpha",
		},
		{
			name: "gnome window",
			spec: specForBinary("gnome-terminal"),
			mode: "window",
			want: "--\x00/usr/bin/ssh\x00alpha",
		},
		{
			name: "konsole tab",
			spec: specForBinary("konsole"),
			mode: "tab",
			want: "--new-tab\x00-e\x00/usr/bin/ssh\x00alpha",
		},
		{
			name: "xfce 位置参数 -x",
			spec: specForBinary("xfce4-terminal"),
			mode: "window",
			want: "-x\x00/usr/bin/ssh\x00alpha",
		},
		{
			name: "kitty 位置参数且无 tab 支持",
			spec: specForBinary("kitty"),
			mode: "tab",
			want: "/usr/bin/ssh\x00alpha",
		},
		{
			name: "wezterm start",
			spec: specForBinary("wezterm"),
			mode: "window",
			want: "start\x00--\x00/usr/bin/ssh\x00alpha",
		},
		{
			name: "空 mode 视为 tab",
			spec: specForBinary("gnome-terminal"),
			mode: "",
			want: "--tab\x00--\x00/usr/bin/ssh\x00alpha",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := buildLinuxTerminalArgs(c.spec, ssh, "alpha", c.mode)
			if strings.Join(got, "\x00") != c.want {
				t.Fatalf("got %q\nwant %q", got, strings.Split(c.want, "\x00"))
			}
		})
	}
}

func TestOpenHostsInTerminalLinuxNoHost(t *testing.T) {
	if err := openHostsInTerminalLinux([]string{"  "}, "tab"); err == nil {
		t.Fatal("空主机应报错")
	}
}
