package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestWindowMaterialMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "theme.json")
	for _, content := range []string{"", "{", `{}`, `{"material":"unknown"}`, `{"material":"acrylic"}`, `{"appearance":"dark"}`, `null`} {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if got := loadWindowMaterial(path); got != "auto" {
			t.Fatalf("%q: got %q", content, got)
		}
	}
	for _, pref := range []string{"auto", "classic", "mica"} {
		if err := saveWindowMaterial(path, pref); err != nil {
			t.Fatal(err)
		}
		if got := loadWindowMaterial(path); got != pref {
			t.Fatalf("saved %q, got %q", pref, got)
		}
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatalf("temporary files leaked: %v", entries)
	}
	if got := loadWindowMaterial(filepath.Join(t.TempDir(), "missing.json")); got != "auto" {
		t.Fatal(got)
	}
}

func TestWindowThemeResolutionAndRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "theme.json")
	supported := true
	failed := false
	enabled := false
	m := newWindowThemeManager(path, "mica", func(string) (bool, string) {
		if !supported {
			return false, "减少透明度"
		}
		return true, ""
	}, func(material string) error {
		on := material == "mica"
		enabled = on
		if failed && on {
			return errors.New("native failure")
		}
		return nil
	})
	if s := m.refresh(false); s.Effective != "mica" || !enabled {
		t.Fatal(s)
	}
	if s, err := m.set("classic"); err != nil || s.Effective != "classic" || enabled {
		t.Fatal(s, err)
	}
	m.refresh(false) // A second startup/detection must not override manual classic.
	if s := m.snapshot(); s.Preference != "classic" || s.Effective != "classic" {
		t.Fatal(s)
	}
	if s, err := m.set("mica"); err != nil || s.Effective != "mica" {
		t.Fatal(s, err)
	}
	supported = false
	if s := m.refresh(false); s.Preference != "mica" || s.Effective != "classic" || enabled || s.Reason == "" {
		t.Fatal(s)
	}
	if got := loadWindowMaterial(path); got != "mica" {
		t.Fatal(got)
	}
	supported = true
	if s := m.refresh(false); s.Effective != "mica" || !enabled {
		t.Fatal(s)
	}
	failed = true
	if s := m.refresh(false); s.Effective != "classic" || s.Supported || enabled || s.Reason != "native failure" {
		t.Fatal(s)
	}
	failed = false
	if s := m.refresh(false); s.Effective != "mica" {
		t.Fatal(s)
	}
	if s := m.refresh(true); s.Effective != "classic" || enabled || s.Preference != "mica" {
		t.Fatal(s)
	}
	if s := m.refresh(false); s.Effective != "mica" {
		t.Fatal(s)
	}
	if _, err := m.set("auto"); err != nil {
		t.Fatal(err)
	}
	if got := loadWindowMaterial(path); got != "auto" {
		t.Fatal(got)
	}
}

func TestWindowThemeSaveFailureLeavesWindowAndPreference(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "file")
	if err := os.WriteFile(blocker, []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	applyCalls := 0
	m := newWindowThemeManager(filepath.Join(blocker, "theme.json"), "mica", func(string) (bool, string) { return true, "" }, func(string) error { applyCalls++; return nil })
	before := m.refresh(false)
	calls := applyCalls
	if _, err := m.set("classic"); err == nil {
		t.Fatal("expected persistence error")
	}
	if m.snapshot() != before || applyCalls != calls {
		t.Fatal("save failure changed native state")
	}
	if _, err := m.set("invalid"); err == nil {
		t.Fatal("invalid preference accepted")
	}
	if m.snapshot() != before {
		t.Fatal("invalid input changed preference")
	}
}

func TestWindowThemeUnsupportedPlatformAndRevision(t *testing.T) {
	m := newWindowThemeManager(filepath.Join(t.TempDir(), "theme.json"), "mica", func(string) (bool, string) { return false, "本版本尚未提供原生云母" }, func(material string) error {
		if material != "classic" {
			t.Error("unsupported platform attempted mica")
		}
		return nil
	})
	first := m.refresh(false)
	second := m.refresh(false)
	if first.Revision != second.Revision {
		t.Fatal("idempotent refresh changed revision")
	}
	for _, pref := range []string{"mica", "classic", "auto"} {
		s, err := m.set(pref)
		if err != nil || s.Preference != pref || s.Effective != "classic" || s.Supported {
			t.Fatal(s, err)
		}
		if s.Revision <= second.Revision {
			t.Fatal("preference change did not advance revision")
		}
		second = s
	}
}

func TestWindowThemeMicaSelectionAndRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "theme.json")
	available, nativeFailure := true, false
	applied := ""
	m := newWindowThemeManager(path, "mica", func(material string) (bool, string) {
		if material != "mica" || !available {
			return false, "系统不支持所选材质"
		}
		return true, ""
	}, func(material string) error {
		applied = material
		if material == "mica" && nativeFailure {
			return errors.New("DWM failure")
		}
		return nil
	})
	if s := m.refresh(false); s.Preference != "auto" || s.Effective != "mica" || applied != "mica" {
		t.Fatal(s)
	}
	if s, err := m.set("classic"); err != nil || s.Effective != "classic" || s.Reason != "" {
		t.Fatal(s, err)
	}
	if s := m.refresh(false); s.Preference != "classic" || s.Effective != "classic" {
		t.Fatal(s)
	}
	if s, err := m.set("mica"); err != nil || s.Effective != "mica" {
		t.Fatal(s, err)
	}
	available = false
	if s := m.refresh(false); s.Preference != "mica" || s.Effective != "classic" || applied != "classic" {
		t.Fatal(s)
	}
	if loadWindowMaterial(path) != "mica" {
		t.Fatal("fallback overwrote preference")
	}
	available, nativeFailure = true, true
	if s := m.refresh(false); s.Effective != "classic" || s.Supported || s.Reason != "DWM failure" || applied != "classic" {
		t.Fatal(s)
	}
	nativeFailure = false
	if s := m.refresh(false); s.Effective != "mica" {
		t.Fatal(s)
	}
	if _, err := m.set("acrylic"); err == nil {
		t.Fatal("acrylic is no longer a valid material")
	}
	if s, err := m.set("auto"); err != nil || s.Effective != "mica" {
		t.Fatal(s, err)
	}
}
