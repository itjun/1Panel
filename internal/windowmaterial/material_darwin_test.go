//go:build darwin

package windowmaterial

import (
	"strings"
	"testing"
)

func TestMacMicaFallback(t *testing.T) {
	if Automatic() != "mica" {
		t.Fatal("Mac automatic material changed")
	}
	available, reason := Capability("mica")
	if available || !strings.Contains(reason, "Windows 11") {
		t.Fatalf("got %v %q", available, reason)
	}
	if available, _ := Capability(Automatic()); available {
		t.Fatal("Mac must fall back to classic")
	}
}
