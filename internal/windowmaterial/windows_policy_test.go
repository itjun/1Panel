package windowmaterial

import "testing"

func TestBackdropCapability(t *testing.T) {
	available := windowsPolicy{build: minimumBackdropBuild, composition: true, transparency: true}
	tests := []struct {
		name   string
		policy windowsPolicy
		want   bool
	}{
		{"Win10", windowsPolicy{build: 19045}, false},
		{"Win11 before documented API", windowsPolicy{build: 22000}, false},
		{"Win11 22H2", available, true},
		{"later Windows", windowsPolicy{build: 26100, composition: true, transparency: true}, true},
		{"composition off", windowsPolicy{build: minimumBackdropBuild, transparency: true}, false},
		{"transparency off", windowsPolicy{build: minimumBackdropBuild, composition: true}, false},
		{"high contrast", windowsPolicy{build: minimumBackdropBuild, composition: true, transparency: true, highContrast: true}, false},
		{"battery saver", windowsPolicy{build: minimumBackdropBuild, composition: true, transparency: true, batterySaver: true}, false},
		{"unreadable settings", windowsPolicy{build: minimumBackdropBuild, composition: true, transparency: true, readFailed: true}, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, reason := backdropCapability(test.policy)
			if got != test.want || (reason == "") != test.want {
				t.Fatalf("got %v %q", got, reason)
			}
		})
	}
}
