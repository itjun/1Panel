package main

import "time"

// startPanelConfigWatcher observes the complete Include tree. Non-conflicting
// external edits are imported into JSON automatically; ambiguous edits are
// only reported so the last good Panel model cannot be silently overwritten.
func (a *App) startPanelConfigWatcher() {
	if a == nil || a.panelStore == nil || a.panelConfigStop != nil {
		return
	}
	stop := make(chan struct{})
	a.panelConfigStop = stop
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				a.pollPanelConfig()
			}
		}
	}()
}

func (a *App) pollPanelConfig() {
	a.panelConfigMu.Lock()
	defer a.panelConfigMu.Unlock()
	state := a.panelStore.Snapshot()
	if state.ConfigStale {
		return
	}
	diff, err := a.comparePanelConfigLocked()
	if err != nil || !diff.HasChanges() {
		return
	}
	if len(diff.Conflicts) > 0 {
		a.emitPanelConfigEvent("panel-config-needs-review", diff)
		return
	}
	result, err := a.importPanelConfigLocked()
	if err != nil {
		a.emitPanelConfigEvent("panel-config-import-error", map[string]any{"error": err.Error(), "diff": diff})
		return
	}
	a.emitPanelConfigEvent("panel-config-imported", result.Diff)
}

func (a *App) emitPanelConfigEvent(name string, payload any) {
	if a != nil && a.app != nil {
		a.app.Event.Emit(name, payload)
	}
}
