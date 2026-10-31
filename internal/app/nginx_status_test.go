package app

import "testing"

func TestParseNginxInstalled(t *testing.T) {
	for _, tc := range []struct {
		name, output         string
		isInstalled, isError bool
	}{
		{"installed", "=1PANEL_NGINX=installed\n", true, false},
		{"missing", "=1PANEL_NGINX=missing\n", false, false},
		{"login banner", "Welcome\r\n=1PANEL_NGINX=installed\r\n", true, false},
		{"empty response", "", false, true},
		{"permission error", "Permission denied", false, true},
		{"unexpected response", "nginx: not found", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			isInstalled, err := parseNginxInstalled(tc.output)
			if isInstalled != tc.isInstalled || (err != nil) != tc.isError {
				t.Fatalf("got (%v, %v), want installed=%v error=%v", isInstalled, err, tc.isInstalled, tc.isError)
			}
		})
	}
}
