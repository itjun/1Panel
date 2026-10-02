package main

import "testing"

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
