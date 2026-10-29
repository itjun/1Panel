//go:build darwin

package windowmaterial

import "testing"

func TestMacMaterialCapabilities(t *testing.T) {
	if Automatic() != "sidebar" {
		t.Fatalf("unexpected automatic material: %s", Automatic())
	}
	if available, reason := Capability("mica"); available || reason == "" {
		t.Fatalf("Windows material should be unavailable: %v %q", available, reason)
	}
	if available, reason := Capability("sidebar"); !available && reason == "" {
		t.Fatal("unavailable material must explain its fallback")
	}
	if !privateMacAPIsEnabled {
		if available, _ := Capability("sidebar"); available {
			t.Fatal("a build without private_mac_apis cannot expose native material")
		}
	}
}
