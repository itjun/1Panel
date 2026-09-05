package desktop

import "testing"

func TestAppleString(t *testing.T) {
	got := appleString(`a"b\c`)
	want := `"a\"b\\c"`
	if got != want {
		t.Fatalf("appleString = %q, want %q", got, want)
	}
}
