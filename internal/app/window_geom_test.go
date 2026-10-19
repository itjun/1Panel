package app

import (
	"encoding/json"
	"testing"
)

func TestApprovedWindowBounds(t *testing.T) {
	for _, tc := range []struct {
		w, h  int
		valid bool
	}{{900, 700, true}, {1050, 700, true}, {1688, 1000, true}, {899, 700, false}, {900, 699, false}} {
		if got := validWindowBounds(windowBounds{Width: tc.w, Height: tc.h}); got != tc.valid {
			t.Errorf("%dx%d valid=%v, want %v", tc.w, tc.h, got, tc.valid)
		}
	}
}

func TestNarrowBoundsKeepSavedGeometryShape(t *testing.T) {
	// Both legacy geometry and the current positioned shape remain readable.
	for _, text := range []string{`{"width":900,"height":700}`, `{"width":900,"height":700,"main":{"width":900,"height":700,"x":80,"y":100,"positionSet":true}}`} {
		var saved windowGeom
		if err := json.Unmarshal([]byte(text), &saved); err != nil {
			t.Fatal(err)
		}
		bounds := windowBounds{Width: saved.Width, Height: saved.Height}
		if saved.Main != nil {
			bounds = *saved.Main
		}
		if !validWindowBounds(bounds) {
			t.Fatalf("approved narrow geometry rejected: %s", text)
		}
	}
}
