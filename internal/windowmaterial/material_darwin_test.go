//go:build darwin

package windowmaterial

import (
	"strings"
	"testing"
)

func TestMacMicaFallback(t *testing.T) {
	if Automatic() != "acrylic" {
		t.Fatal("Mac automatic material changed")
	}
	available, reason := Capability("mica")
	if available || !strings.Contains(reason, "Windows 11") {
		t.Fatalf("got %v %q", available, reason)
	}
}
