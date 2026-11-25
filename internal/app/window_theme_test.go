package app

import (
	"errors"
	"testing"
)

func TestAutomaticWindowTheme(t *testing.T) {
	for _, native := range []string{"sidebar", "mica"} {
		t.Run(native, func(t *testing.T) {
			available, fail := true, false
			applied := ""
			m := newWindowThemeManager(native, func(material string) (bool, string) {
				if material != native {
					t.Fatalf("unexpected material %q", material)
				}
				if !available {
					return false, "减少透明度"
				}
				return true, ""
			}, func(material string) error {
				applied = material
				if fail && material == native {
					return errors.New("native failure")
				}
				return nil
			})
			check := func(forceClassic bool, want string) WindowThemeState {
				t.Helper()
				state := m.refresh(forceClassic)
				if state.Effective != want || applied != want || state != m.snapshot() {
					t.Fatalf("wanted %s, native %s, state %+v", want, applied, state)
				}
				return state
			}
			first := check(false, native)
			if check(false, native).Revision != first.Revision {
				t.Fatal("idempotent refresh changed revision")
			}
			available = false
			fallback := check(false, "classic")
			if fallback.Supported || fallback.Reason == "" || fallback.Revision <= first.Revision {
				t.Fatal(fallback)
			}
			available = true
			check(false, native)
			fail = true
			if state := check(false, "classic"); state.Supported || state.Reason != "native failure" {
				t.Fatal(state)
			}
			fail = false
			check(true, "classic")
			check(false, native)
		})
	}
}
