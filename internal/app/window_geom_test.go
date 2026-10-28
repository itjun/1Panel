package app

import (
	"encoding/json"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
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

func TestWindowBoundsForScreen(t *testing.T) {
	for _, tc := range []struct {
		name   string
		screen *application.Screen
		want   windowBounds
		ok     bool
	}{
		{"standard", &application.Screen{Bounds: application.Rect{Width: 1920, Height: 1080}}, windowBounds{Width: 1536, Height: 864, X: 192, Y: 108, PositionSet: true}, true},
		{"offset display", &application.Screen{Bounds: application.Rect{X: -2560, Y: -200, Width: 2560, Height: 1440}}, windowBounds{Width: 2048, Height: 1152, X: -2304, Y: -56, PositionSet: true}, true},
		{"minimum", &application.Screen{Bounds: application.Rect{Width: 1000, Height: 800}}, windowBounds{Width: 900, Height: 700, X: 50, Y: 50, PositionSet: true}, true},
		{"unavailable", nil, windowBounds{}, false},
		{"invalid", &application.Screen{Bounds: application.Rect{Width: 0, Height: 800}}, windowBounds{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := windowBoundsForScreen(tc.screen)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("got %+v, %v; want %+v, %v", got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestScreenForSavedBounds(t *testing.T) {
	primary := &application.Screen{ID: "primary", Bounds: application.Rect{Width: 1920, Height: 1080}}
	external := &application.Screen{ID: "external", Bounds: application.Rect{X: -2560, Width: 2560, Height: 1440}}
	screens := []*application.Screen{primary, external}
	for _, tc := range []struct {
		name        string
		bounds      windowBounds
		positionSet bool
		screens     []*application.Screen
		primary     *application.Screen
		want        *application.Screen
	}{
		{"external", windowBounds{X: -2400, Y: 100, Width: 1600, Height: 900}, true, screens, primary, external},
		{"largest overlap", windowBounds{X: -300, Y: 100, Width: 1200, Height: 800}, true, screens, primary, primary},
		{"removed display", windowBounds{X: -2400, Y: 100, Width: 1600, Height: 900}, true, []*application.Screen{primary}, primary, primary},
		{"legacy without position", windowBounds{Width: 1200, Height: 800}, false, screens, primary, primary},
		{"no screens", windowBounds{}, false, nil, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := screenForSavedBounds(tc.screens, tc.primary, tc.bounds, tc.positionSet); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
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
