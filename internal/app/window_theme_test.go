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
			m := newWindowThemeManager([]string{native}, func(material string) (bool, string) {
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

func TestWindowMaterialPriority(t *testing.T) {
	failMica := true
	applied := ""
	m := newWindowThemeManager([]string{"mica", "translucent"}, func(string) (bool, string) {
		return true, ""
	}, func(material string) error {
		applied = material
		if failMica && material == "mica" {
			return errors.New("mica failed")
		}
		return nil
	})
	state := m.refresh(false)
	if state.Effective != "translucent" || !state.Supported || applied != "translucent" {
		t.Fatalf("wanted translucent, applied %s, state %+v", applied, state)
	}
	failMica = false
	state = m.refresh(false)
	if state.Effective != "mica" || applied != "mica" {
		t.Fatalf("wanted mica, applied %s, state %+v", applied, state)
	}
	m = newWindowThemeManager([]string{"mica", "translucent"}, func(string) (bool, string) {
		return false, "系统已关闭透明效果，正在使用经典外观"
	}, func(material string) error {
		applied = material
		return nil
	})
	state = m.refresh(false)
	if state.Effective != "classic" || state.Supported || state.Reason == "" || applied != "classic" {
		t.Fatalf("wanted classic, applied %s, state %+v", applied, state)
	}
	applied = ""
	m = newWindowThemeManager([]string{"mica", "translucent"}, func(material string) (bool, string) {
		if material == "mica" {
			return false, "原生云母需要 Windows 11 22H2（build 22621）及以上，正在使用经典外观"
		}
		return true, ""
	}, func(material string) error {
		applied = material
		return nil
	})
	state = m.refresh(false)
	if state.Effective != "translucent" || !state.Supported || applied != "translucent" {
		t.Fatalf("wanted translucent fallback, applied %s, state %+v", applied, state)
	}
}
