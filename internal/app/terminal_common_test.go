package app

import "testing"

func TestChooseListedTerminal(t *testing.T) {
	both := []TerminalApp{{ID: "ghostty"}, {ID: "terminal"}}
	if got := chooseListedTerminal(both, "terminal", "ghostty"); got != "terminal" {
		t.Fatalf("explicit = %s", got)
	}
	if got := chooseListedTerminal(both, "", "ghostty"); got != "ghostty" {
		t.Fatalf("fallback = %s", got)
	}
	if got := chooseListedTerminal(both, "missing", "ghostty"); got != "missing" {
		t.Fatalf("explicit selection must be preserved, got %s", got)
	}
	only := []TerminalApp{{ID: "terminal"}}
	if got := chooseListedTerminal(only, "ghostty", "ghostty"); got != "ghostty" {
		t.Fatalf("single available app must not replace selection, got %s", got)
	}
	if got := chooseListedTerminal(nil, "ghostty", "ghostty"); got != "ghostty" {
		t.Fatalf("empty = %q", got)
	}
}
