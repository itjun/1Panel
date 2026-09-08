package agentres

import "testing"

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
