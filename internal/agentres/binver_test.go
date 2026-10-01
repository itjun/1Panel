package agentres

import (
	"io/fs"
	"testing"
)

func TestParseVersionFromLdflags(t *testing.T) {
	got := parseVersionFromLdflags("-s -w -X main.version=0.2.22")
	if got != "0.2.22" {
		t.Fatalf("got %q", got)
	}
	got = parseVersionFromLdflags("-X main.version=1.0.0 -s")
	if got != "1.0.0" {
		t.Fatalf("got %q", got)
	}
	if parseVersionFromLdflags("-s -w") != "" {
		t.Fatal("want empty")
	}
}

func TestEmbedBinNotEmpty(t *testing.T) {
	entries, err := fs.ReadDir(files, "bin")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("bin 为空：新克隆无法通过 go:embed all:bin 编译")
	}
}
