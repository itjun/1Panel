package sshd

import (
	"os/exec"
	"strings"
	"testing"
)

func TestShellQuoteRoundTrip(t *testing.T) {
	cases := []string{
		"plain",
		"it's",
		`a "b" $HOME \n`,
		"line1\nline2 <<'UNIT'\nUNIT",
		"''",
	}
	for _, in := range cases {
		out, err := exec.Command("sh", "-c", "printf %s "+shellQuote(in)).Output()
		if err != nil {
			t.Fatalf("sh 执行失败 %q: %v", in, err)
		}
		if string(out) != in {
			t.Fatalf("转义往返不一致: 期望 %q，得到 %q", in, out)
		}
	}
}

func TestRootWrapBranches(t *testing.T) {
	cmd := rootWrap("echo hi")
	for _, part := range []string{`"$(id -u)" = 0`, "sudo -n true", "sudo -n sh -c 'echo hi'", "sudo -S -p '' sh -c 'echo hi'"} {
		if !strings.Contains(cmd, part) {
			t.Fatalf("缺少片段 %q: %s", part, cmd)
		}
	}
}

func TestIsSudoDenied(t *testing.T) {
	denied := []string{
		"sudo: a password is required",
		"sudo: no password was provided\nsudo: 1 incorrect password attempt",
		"box is not in the sudoers file.  This incident will be reported.",
		"sh: 1: sudo: not found",
		"bash: sudo: command not found",
	}
	for _, out := range denied {
		if !isSudoDenied(out) {
			t.Fatalf("应识别为提权失败: %q", out)
		}
	}
	for _, out := range []string{"", "mv: cannot stat '/tmp/x': No such file or directory"} {
		if isSudoDenied(out) {
			t.Fatalf("不应识别为提权失败: %q", out)
		}
	}
}
