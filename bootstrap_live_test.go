package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/sshd"
)

// Opt-in: installs the software bundle and complete shell environment on the
// explicitly named host. It checks restoration, then leaves zsh as the login shell.
// ONEPANEL_ZSH_LIVE_HOST=template go test . -run TestZshLiveHost -v -count=1 -timeout 45m
func TestZshLiveHost(t *testing.T) {
	host := os.Getenv("ONEPANEL_ZSH_LIVE_HOST")
	if host == "" {
		t.Skip("set ONEPANEL_ZSH_LIVE_HOST to authorize a real host installation")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	config, err := exec.CommandContext(ctx, "ssh", "-G", "--", host).Output()
	if err != nil {
		t.Fatalf("resolve SSH host: %v", err)
	}
	h := panelstore.PanelHost{Alias: host}
	for _, line := range strings.Split(string(config), "\n") {
		key, value, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		switch key {
		case "hostname":
			h.HostName = value
		case "user":
			h.User = value
		case "port":
			h.Port = value
		case "identityfile":
			h.IdentityFiles = append(h.IdentityFiles, value)
		case "proxyjump":
			if value != "none" {
				h.ProxyJump = value
			}
		case "proxycommand":
			if value != "none" {
				h.ProxyCommand = value
			}
		case "identityagent":
			if value != "none" && value != "SSH_AUTH_SOCK" {
				h.IdentityAgent = value
			}
		}
	}
	store, err := panelstore.NewStoreAt(filepath.Join(t.TempDir(), "panel.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Replace(panelstore.State{Version: panelstore.CurrentVersion, Hosts: []panelstore.PanelHost{h}}); err != nil {
		t.Fatal(err)
	}
	manager := sshd.NewManager()
	t.Cleanup(manager.CloseAll)
	system := (*System)(&App{sshMgr: manager, panelStore: store})
	before, err := system.InspectZsh(host)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("baseline: system=%s user=%s shell=%s zsh=%q git=%v", before.Distribution, before.User, before.Shell, before.Zsh, before.Git)
	opt, err := (*App)(system).connectOptionFor(host)
	if err != nil {
		t.Fatal(err)
	}
	desiredShell := before.Shell
	// Restore the intended login shell even if a later assertion fails.
	t.Cleanup(func() {
		env, err := system.InspectZsh(host)
		if err != nil {
			t.Errorf("cannot confirm the final login shell: %v", err)
			return
		}
		if env.Shell == desiredShell {
			return
		}
		command := "chsh -s " + zshShellQuote(desiredShell) + " " + zshShellQuote(before.User)
		if before.User != "root" {
			command = "sudo -n " + command
		}
		if output, err := manager.Run(host, opt, command, sshd.RunOptions{Timeout: 15 * time.Second}); err != nil {
			t.Errorf("cannot restore the original login shell: %v %s", err, output)
		}
	})
	run := func(script string) string {
		t.Helper()
		out, err := manager.Run(host, opt, "sh -c "+zshShellQuote(script), sshd.RunOptions{Timeout: 30 * time.Second})
		if err != nil {
			t.Fatalf("remote check: %v: %s", err, out)
		}
		return strings.TrimSpace(string(out))
	}
	startAndWait := func(options ZshSetupOptions, checkConcurrent bool) ZshSetupTask {
		t.Helper()
		var initial ZshSetupTask
		var err error
		if options.BasePackages {
			initial, err = system.StartHostSetup(host)
			if err == nil && initial.Options != options {
				t.Fatalf("one-click host setup options mismatch: %+v", initial.Options)
			}
		} else {
			initial, err = system.StartZshSetup(host, options)
		}
		if err != nil {
			t.Fatal(err)
		}
		if initial.State != "running" || initial.Host != host {
			t.Fatalf("invalid initial task: %+v", initial)
		}
		if checkConcurrent {
			if _, err := system.StartZshSetup(host, options); err == nil || !strings.Contains(err.Error(), "已有初始化任务") {
				t.Fatalf("concurrent setup not blocked: %v", err)
			}
		}
		deadline := time.Now().Add(zshSetupTimeout + time.Minute)
		printed := 0
		for time.Now().Before(deadline) {
			task := system.GetZshSetup(host)
			for _, line := range task.Logs[printed:] {
				t.Log(line)
			}
			printed = len(task.Logs)
			if task.State != "running" {
				if task.State != "success" {
					t.Fatalf("setup failed: %s", task.Error)
				}
				if task.FinishedAt < task.StartedAt || len(task.Logs) < 3 {
					t.Fatal("completion metadata or streaming logs missing")
				}
				return task
			}
			time.Sleep(500 * time.Millisecond)
		}
		t.Fatal("setup task did not finish")
		return ZshSetupTask{}
	}
	options := ZshSetupOptions{Highlighting: true, Suggestions: true, Correction: false}
	startAndWait(options, true)
	installed, err := system.InspectZsh(host)
	if err != nil {
		t.Fatal(err)
	}
	if installed.Zsh == "" || !installed.Managed || !installed.HighlightingEnabled || !installed.SuggestionsEnabled || installed.CorrectionEnabled || installed.RestoreCommand == "" {
		t.Fatalf("incomplete installed environment: %+v", installed)
	}
	if installed.Shell != before.Shell {
		t.Fatal("default setup unexpectedly changed the login shell")
	}
	hash := run("sha256sum " + zshShellQuote(installed.Zshrc))
	startAndWait(options, false)
	if again := run("sha256sum " + zshShellQuote(installed.Zshrc)); again != hash {
		t.Fatalf("repeat setup changed rc: %s -> %s", hash, again)
	}
	if count := run("grep -Fxc '# >>> 1Panel zsh >>>' " + zshShellQuote(installed.Zshrc)); count != "1" {
		t.Fatalf("duplicate managed markers: %s", count)
	}
	t.Log("PASS: real installation, log polling, concurrent guard, and repeat setup")

	// Exercise chsh, then use the generated restore command to return to the
	// original login shell. This restores the initialized rc from the prior run.
	options.DefaultShell = true
	startAndWait(options, false)
	changed, err := system.InspectZsh(host)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(changed.Shell, "/zsh") {
		t.Fatalf("chsh did not take effect: %q", changed.Shell)
	}
	if changed.RestoreCommand == "" {
		t.Fatal("missing restore command")
	}
	t.Log(run(changed.RestoreCommand))
	manager.Close(host)
	restored, err := system.InspectZsh(host)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Shell != before.Shell || !restored.Managed || restored.CorrectionEnabled {
		t.Fatalf("restore mismatch: %+v", restored)
	}
	if again := run("sha256sum " + zshShellQuote(restored.Zshrc)); again != hash {
		t.Fatal("restore changed initialized rc")
	}
	if leftovers := run("find /tmp -maxdepth 1 -name '.1panel-zsh.*' -print; find \"$HOME/.local/share/1panel/zsh\" -maxdepth 1 \\( -name '.work.*' -o -name '.lock' \\) -print"); leftovers != "" {
		t.Fatalf("temporary setup files remain: %s", leftovers)
	}
	t.Logf("PASS: default-shell switching and backup restoration; final shell=%s", restored.Shell)

	// Exercise the exact right-click API with all software and enhancements.
	sourcesBefore := run(`find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -exec sha256sum {} \; | sort`)
	full := ZshSetupOptions{BasePackages: true, Highlighting: true, Suggestions: true, Correction: false, DefaultShell: true}
	startAndWait(full, true)
	complete, err := system.InspectZsh(host)
	if err != nil || !complete.OhMyZsh || complete.Theme != "ys" || !strings.HasSuffix(complete.Shell, "/zsh") || !complete.HighlightingEnabled || !complete.SuggestionsEnabled || complete.CorrectionEnabled {
		t.Fatalf("host setup incomplete: %+v (%v)", complete, err)
	}
	desiredShell = complete.Shell
	t.Log(run(`zsh -ic '(( $+functions[omz] && $+functions[_omz_source] )) && [[ -f "$ZSH/oh-my-zsh.sh" && "$ZSH_THEME" == ys && ! -o correct && ! -o correctall ]] && print -r -- "OH_MY_ZSH_RUNTIME_PASS $ZSH CORRECT=$options[correct] CORRECTALL=$options[correctall]"'`))
	t.Log(run("find " + zshShellQuote(complete.OhMyZshRoot+"/plugins") + " -mindepth 1 -maxdepth 1 -type d | wc -l"))
	if complete.Manager == "apt-get" {
		t.Log(run(`dpkg-query -W -f='${Package} ${Status}\n' openssh-server vim curl wget sudo tree ca-certificates zsh git htop btop`))
		if missing := run(`dpkg-query -W -f='${Package} ${Status}\n' openssh-server vim curl wget sudo tree ca-certificates zsh git htop btop | awk '$NF != "installed" {print}'`); missing != "" {
			t.Fatalf("packages missing: %s", missing)
		}
		if enabled := run("systemctl is-enabled ssh"); enabled != "enabled" {
			t.Fatalf("SSH startup not enabled: %s", enabled)
		}
		if sourcesAfter := run(`find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -exec sha256sum {} \; | sort`); sourcesAfter != sourcesBefore {
			t.Fatal("host setup replaced existing package sources")
		}
	}
	t.Log("PASS: StartHostSetup installed the itjun-tools bundle, enabled SSH, retained sources, and configured ys with all enhancements")
}
