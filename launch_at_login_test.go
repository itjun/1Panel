package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeLoginStartup struct {
	enabled       bool
	enables       int
	disables      int
	writeError    error
	readError     error
	needsApproval bool
}

func (f *fakeLoginStartup) Enable() error {
	f.enables++
	if f.writeError == nil && !f.needsApproval {
		f.enabled = true
	}
	return f.writeError
}

func (f *fakeLoginStartup) Disable() error {
	f.disables++
	if f.writeError == nil {
		f.enabled = false
	}
	return f.writeError
}

func (f *fakeLoginStartup) IsEnabled() (bool, error) { return f.enabled, f.readError }

func newTestLoginManager(t *testing.T, native *fakeLoginStartup) *launchAtLoginManager {
	t.Helper()
	return &launchAtLoginManager{startup: native, path: filepath.Join(t.TempDir(), "config", "launch-at-login.initialized")}
}

func TestLaunchAtLoginDefaultAndOptOutSurviveRestart(t *testing.T) {
	native := &fakeLoginStartup{}
	m := newTestLoginManager(t, native)
	if err := m.initialize(); err != nil {
		t.Fatal(err)
	}
	if !native.enabled || native.enables != 1 {
		t.Fatalf("first launch did not enable startup: %+v", native)
	}
	if _, err := m.set(false); err != nil {
		t.Fatal(err)
	}
	reloaded := &launchAtLoginManager{startup: native, path: m.path}
	if err := reloaded.initialize(); err != nil {
		t.Fatal(err)
	}
	state, err := reloaded.snapshot()
	if err != nil || state.Enabled || native.enables != 1 || native.disables != 1 {
		t.Fatalf("restart reversed the opt-out: %+v, %+v, %v", native, state, err)
	}
	if state, err = reloaded.set(true); err != nil || !state.Enabled {
		t.Fatalf("explicit re-enable failed: %+v, %v", state, err)
	}
}

func TestLaunchAtLoginHonorsChangesMadeInSystemSettings(t *testing.T) {
	native := &fakeLoginStartup{}
	m := newTestLoginManager(t, native)
	if err := m.initialize(); err != nil {
		t.Fatal(err)
	}
	native.enabled = false
	reloaded := &launchAtLoginManager{startup: native, path: m.path}
	if err := reloaded.initialize(); err != nil {
		t.Fatal(err)
	}
	state, err := reloaded.snapshot()
	if err != nil || state.Enabled || native.enables != 1 {
		t.Fatalf("system opt-out was overridden: %+v, %+v, %v", native, state, err)
	}
	native.enabled = true
	state, err = reloaded.snapshot()
	if err != nil || !state.Enabled {
		t.Fatalf("system state was not refreshed: %+v, %v", state, err)
	}
}

func TestLaunchAtLoginExistingRegistrationIsNotReplaced(t *testing.T) {
	native := &fakeLoginStartup{enabled: true}
	m := newTestLoginManager(t, native)
	if err := m.initialize(); err != nil || native.enables != 0 {
		t.Fatalf("existing registration was replaced: %+v, %v", native, err)
	}
	if _, err := os.Stat(m.path); err != nil {
		t.Fatal(err)
	}
}

func TestLaunchAtLoginNativeFailureDoesNotReportSuccessOrRetryAtBoot(t *testing.T) {
	native := &fakeLoginStartup{writeError: errors.New("access denied")}
	m := newTestLoginManager(t, native)
	if err := m.initialize(); err == nil {
		t.Fatal("registration failure was hidden")
	}
	state, err := m.snapshot()
	if err != nil || state.Enabled || !strings.Contains(state.Reason, "access denied") {
		t.Fatalf("failure not visible: %+v, %v", state, err)
	}
	if err := m.initialize(); err != nil || native.enables != 1 {
		t.Fatalf("registration was retried without user action: %+v, %v", native, err)
	}
	native.writeError = nil
	if state, err = m.set(true); err != nil || !state.Enabled || state.Reason != "" {
		t.Fatalf("explicit retry failed: %+v, %v", state, err)
	}
}

func TestLaunchAtLoginPendingSystemApproval(t *testing.T) {
	native := &fakeLoginStartup{needsApproval: true}
	m := newTestLoginManager(t, native)
	if err := m.initialize(); err != nil {
		t.Fatal(err)
	}
	state, err := m.snapshot()
	if err != nil || state.Enabled || state.Reason == "" {
		t.Fatalf("pending approval reported as enabled: %+v, %v", state, err)
	}
	native.enabled = true
	state, err = m.snapshot()
	if err != nil || !state.Enabled || state.Reason != "" {
		t.Fatalf("approval did not clear pending reason: %+v, %v", state, err)
	}
}

func TestLaunchAtLoginCannotPersistDoesNotChangeOS(t *testing.T) {
	native := &fakeLoginStartup{enabled: true}
	m := newTestLoginManager(t, native)
	if err := os.WriteFile(filepath.Dir(m.path), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.set(false); err == nil || native.disables != 0 || !native.enabled {
		t.Fatalf("OS changed despite persistence failure: %+v, %v", native, err)
	}
}

func TestLaunchAtLoginReadFailure(t *testing.T) {
	m := newTestLoginManager(t, &fakeLoginStartup{readError: errors.New("unreadable")})
	if _, err := m.snapshot(); err == nil {
		t.Fatal("read error reported as a disabled setting")
	}
}

func TestLaunchAtLoginUnavailableDoesNotTouchDisk(t *testing.T) {
	m := &launchAtLoginManager{path: filepath.Join(t.TempDir(), "marker"), reason: "unsupported"}
	if err := m.initialize(); err != nil {
		t.Fatal(err)
	}
	state, err := m.snapshot()
	if err != nil || state.Supported || state.Reason != "unsupported" {
		t.Fatalf("unexpected unsupported state: %+v, %v", state, err)
	}
	if _, err := m.set(true); err == nil {
		t.Fatal("unsupported environment accepted registration")
	}
	if _, err := os.Stat(m.path); !os.IsNotExist(err) {
		t.Fatalf("unsupported environment wrote a marker: %v", err)
	}
}
