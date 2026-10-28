package app

import (
	"fmt"
	"strings"
	"time"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/panelsync"
)

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
	if state.ConfigStale && !strings.HasPrefix(state.LastError, "SSH 配置已被外部修改") {
		return
	}
	diff, err := a.comparePanelConfigLocked()
	if err != nil {
		return
	}
	if !diff.HasChanges() {
		if state.ConfigStale {
			_ = a.panelStore.Update(func(state *panelstore.State) error {
				state.ConfigStale = false
				state.LastError = ""
				return nil
			})
		}
		return
	}
	if len(diff.Conflicts) > 0 {
		if err := a.importUnambiguousHostChanges(state, diff); err != nil {
			a.emitPanelConfigEvent("panel-config-import-error", map[string]any{"error": err.Error(), "diff": diff})
		}
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

// A missing host needs a decision, but it must not block unrelated connection
// updates. Keep the old file snapshot so the removal remains visible.
func (a *App) importUnambiguousHostChanges(state panelstore.State, diff panelsync.ConfigDiff) error {
	if diff.Imported == nil || len(diff.ChangedHosts) == 0 || len(diff.RemovedHosts) == 0 {
		return nil
	}
	allowed := make(map[string]bool, len(diff.RemovedHosts))
	for _, alias := range diff.RemovedHosts {
		allowed[fmt.Sprintf("Host %s 从 SSH 配置消失，可能丢失 Panel 密码或分组/备注", alias)] = true
	}
	for _, conflict := range diff.Conflicts {
		if !allowed[conflict] {
			return nil
		}
	}
	changed := make(map[string]panelstore.PanelHost, len(diff.ChangedHosts))
	for _, alias := range diff.ChangedHosts {
		if host, ok := hostByAlias(diff.Imported.Hosts, alias); ok {
			changed[alias] = host
		}
	}
	if len(changed) == 0 {
		return nil
	}
	next := a.panelStore.Snapshot()
	for i, host := range next.Hosts {
		if updated, ok := changed[host.Alias]; ok {
			next.Hosts[i] = updated
		}
	}
	if err := a.backupPanelStateLocked(); err != nil {
		return err
	}
	if err := a.panelStore.Replace(next); err != nil {
		return err
	}
	a.invalidateChangedPanelConnections(state, next)
	if err := a.syncLegacyGroupsFromPanel(next); err != nil {
		return err
	}
	a.emitPanelConfigEvent("panel-config-imported", diff)
	return nil
}

func (a *App) emitPanelConfigEvent(name string, payload any) {
	if a != nil && a.app != nil {
		a.app.Event.Emit(name, payload)
	}
}
