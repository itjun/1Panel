//go:build darwin

package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func appLookup(apps map[string]macAppInfo) func(string) (macAppInfo, bool) {
	return func(name string) (macAppInfo, bool) {
		info, ok := apps[name]
		return info, ok
	}
}

func officialGhosttyInfo() macAppInfo {
	return macAppInfo{
		path:       "/Applications/Ghostty.app",
		bundleID:   officialGhosttyBundleID,
		executable: officialGhosttyExecutable,
		teamID:     officialGhosttyTeamID,
	}
}

func oneAgentInfo() macAppInfo {
	return macAppInfo{
		path:       "/Applications/1Agent.app",
		bundleID:   oneAgentBundleID,
		executable: oneAgentExecutable,
	}
}

func TestChooseMacTerminal(t *testing.T) {
	official := officialGhosttyInfo()
	agent := oneAgentInfo()
	lookupAll := appLookup(map[string]macAppInfo{"Ghostty": official, "1Agent": agent})
	if got := chooseMacTerminal(lookupAll, ""); got.kind != macTerminalGhostty || got.appPath != official.path {
		t.Fatalf("official Ghostty wins by default, got %+v", got)
	}
	if got := chooseMacTerminal(lookupAll, macTerminalTerminalID); got.kind != macTerminalTerminal {
		t.Fatalf("explicit system terminal, got %+v", got)
	}
	if got := chooseMacTerminal(lookupAll, macTerminalGhosttyID); got.kind != macTerminalGhostty {
		t.Fatalf("explicit ghostty, got %+v", got)
	}
	if got := chooseMacTerminal(lookupAll, macTerminal1AgentID); got.kind != macTerminal1Agent {
		t.Fatalf("explicit 1Agent, got %+v", got)
	}
	apps := listMacTerminalApps(lookupAll)
	if len(apps) != 3 || apps[0].ID != macTerminal1AgentID || apps[1].ID != macTerminalGhosttyID || !apps[1].Default || apps[2].ID != macTerminalTerminalID || apps[2].SupportsWindow {
		t.Fatalf("apps = %+v", apps)
	}
	onlyAgent := appLookup(map[string]macAppInfo{"1Agent": agent})
	if got := chooseMacTerminal(onlyAgent, ""); got.kind != macTerminal1Agent {
		t.Fatalf("1Agent is default without Ghostty, got %+v", got)
	}
	fake := agent
	fake.bundleID = "com.example.other"
	if apps := listMacTerminalApps(appLookup(map[string]macAppInfo{"1Agent": fake})); len(apps) != 1 || apps[0].ID != macTerminalTerminalID {
		t.Fatalf("fake 1Agent must not be listed, got %+v", apps)
	}

	impersonator := official
	impersonator.bundleID = "com.itjun.1agent"
	impersonator.executable = "Ghostty"
	impersonator.teamID = ""
	impersonatorLookup := appLookup(map[string]macAppInfo{"Ghostty": impersonator})
	if got := chooseMacTerminal(impersonatorLookup, macTerminalGhosttyID); got.kind != macTerminalTerminal {
		t.Fatalf("impersonator must fall through, got %+v", got)
	}
	if apps := listMacTerminalApps(impersonatorLookup); len(apps) != 1 || apps[0].ID != macTerminalTerminalID {
		t.Fatalf("impersonator must not be listed, got %+v", apps)
	}

	wrongExec := official
	wrongExec.executable = "Ghostty"
	if got := chooseMacTerminal(appLookup(map[string]macAppInfo{"Ghostty": wrongExec}), ""); got.kind != macTerminalTerminal {
		t.Fatalf("wrong executable must fall through, got %+v", got)
	}

	wrongTeam := official
	wrongTeam.teamID = "not-official"
	if got := chooseMacTerminal(appLookup(map[string]macAppInfo{"Ghostty": wrongTeam}), ""); got.kind != macTerminalTerminal {
		t.Fatalf("wrong team must fall through, got %+v", got)
	}

	if got := chooseMacTerminal(appLookup(nil), macTerminalGhosttyID); got.kind != macTerminalTerminal {
		t.Fatalf("fallback = %s", got.kind)
	}
}

func officialOttyInfo() macAppInfo {
	return macAppInfo{
		path:       "/Applications/Otty.app",
		bundleID:   officialOttyBundleID,
		executable: officialOttyExecutable,
		teamID:     officialOttyTeamID,
	}
}

func TestChooseMacTerminalOtty(t *testing.T) {
	otty := officialOttyInfo()
	lookup := appLookup(map[string]macAppInfo{"Otty": otty, "Ghostty": officialGhosttyInfo(), "1Agent": oneAgentInfo()})
	apps := listMacTerminalApps(lookup)
	if len(apps) != 4 || apps[2].ID != macTerminalOttyID || apps[2].SupportsWindow || apps[3].SupportsWindow || apps[1].ID != macTerminalGhosttyID || !apps[1].Default {
		t.Fatalf("apps = %+v", apps)
	}
	if got := chooseMacTerminal(lookup, macTerminalOttyID); got.kind != macTerminalOtty || got.appPath != otty.path {
		t.Fatalf("explicit otty = %+v", got)
	}
	only := appLookup(map[string]macAppInfo{"Otty": otty})
	if got := chooseMacTerminal(only, ""); got.kind != macTerminalOtty {
		t.Fatalf("otty default without the others = %+v", got)
	}
	fake := otty
	fake.teamID = "not-official"
	if apps := listMacTerminalApps(appLookup(map[string]macAppInfo{"Otty": fake})); len(apps) != 1 || apps[0].ID != macTerminalTerminalID {
		t.Fatalf("fake Otty must not be listed, got %+v", apps)
	}
}

func TestPlanMacOpenOtty(t *testing.T) {
	choice := macTerminalChoice{kind: macTerminalOtty, appPath: "/Applications/Otty.app"}
	tab, err := planMacOpen(choice, []string{"alpha", "bad;rm"}, "tab", "/usr/bin/ssh")
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{
		"/Applications/Otty.app/Contents/MacOS/otty-cli",
		"tab", "new", "--json", "--command", "exec '/usr/bin/ssh' -- 'alpha'",
	}, "\x00")
	if len(tab.commands) != 1 || strings.Join(tab.commands[0], "\x00") != want {
		t.Fatalf("tab argv = %#v", tab.commands)
	}
	window, err := planMacOpen(choice, []string{"alpha"}, "window", "/usr/bin/ssh")
	if err != nil {
		t.Fatal(err)
	}
	if len(window.commands) != 1 || window.commands[0][1] != "tab" {
		t.Fatalf("window mode must still open a tab, argv = %#v", window.commands)
	}
	if _, err := planMacOpen(macTerminalChoice{kind: macTerminalOtty}, []string{"alpha"}, "tab", "/usr/bin/ssh"); err == nil {
		t.Fatal("otty without app path should fail")
	}
}

func TestPlanMacOpen1Agent(t *testing.T) {
	plan, err := planMacOpen(macTerminalChoice{kind: macTerminal1Agent}, []string{"alpha", "beta box"}, "window", "/usr/bin/ssh")
	if err != nil {
		t.Fatal(err)
	}
	if plan.openURL != "oneagent://open?host=alpha&host=beta%20box&reuse=1" {
		t.Fatalf("url = %s", plan.openURL)
	}
	if len(plan.commands) != 0 || len(plan.scripts) != 0 {
		t.Fatalf("1Agent plan should only carry a URL: %+v", plan)
	}
}

func TestPlanMacOpenGhostty(t *testing.T) {
	plan, err := planMacOpen(macTerminalChoice{kind: macTerminalGhostty, appPath: "/Applications/Ghostty.app"}, []string{"alpha", "bad;rm", "beta"}, "window", "/usr/bin/ssh")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.commands) != 2 || len(plan.scripts) != 0 {
		t.Fatalf("commands = %v scripts = %d", plan.commands, len(plan.scripts))
	}
	want := strings.Join([]string{"-na", "/Applications/Ghostty.app", "--args", "-e", "/usr/bin/ssh", "--", "alpha"}, "\x00")
	if strings.Join(plan.commands[0], "\x00") != want {
		t.Fatalf("argv = %q", plan.commands[0])
	}
	if plan.commands[1][len(plan.commands[1])-1] != "beta" {
		t.Fatalf("second host = %q", plan.commands[1])
	}
	if _, err := planMacOpen(macTerminalChoice{kind: macTerminalGhostty}, []string{"alpha"}, "tab", "/usr/bin/ssh"); err == nil {
		t.Fatal("ghostty without app path should fail")
	}
}

func TestPlanMacOpenTerminal(t *testing.T) {
	term, err := planMacOpen(macTerminalChoice{kind: macTerminalTerminal}, []string{"alpha"}, "tab", "/usr/bin/ssh")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(term.scripts[0], `keystroke "t"`) || !strings.Contains(term.scripts[0], "on error") {
		t.Fatalf("terminal tab script:\n%s", term.scripts[0])
	}
	if !strings.Contains(term.scripts[0], `exec /usr/bin/ssh 'alpha'`) {
		t.Fatalf("ssh command missing:\n%s", term.scripts[0])
	}
	window, err := planMacOpen(macTerminalChoice{kind: macTerminalTerminal}, []string{"alpha"}, "window", "/usr/bin/ssh")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(window.scripts[0], "on error") || !strings.Contains(window.scripts[0], `keystroke "t"`) {
		t.Fatalf("window mode must still open a tab:\n%s", window.scripts[0])
	}
}

func TestPlanMacOpenNoHost(t *testing.T) {
	if _, err := planMacOpen(macTerminalChoice{kind: macTerminalGhostty, appPath: "/Applications/Ghostty.app"}, []string{"bad\nhost"}, "tab", "/usr/bin/ssh"); err == nil {
		t.Fatal("ghostty empty hosts should fail")
	}
	if _, err := planMacOpen(macTerminalChoice{kind: macTerminalTerminal}, []string{"  "}, "tab", "/usr/bin/ssh"); err == nil {
		t.Fatal("terminal empty hosts should fail")
	}
}

func TestOpenHostsInTerminalDarwinNoHost(t *testing.T) {
	if err := openHostsInTerminalDarwin([]string{"  ", ""}, "tab", ""); err == nil {
		t.Fatal("blank hosts should fail before launching a terminal")
	}
}

func TestOttyCreatedTabID(t *testing.T) {
	got := ottyCreatedTabID("{\"data\":{\"id\":\"t_abc\",\"index\":1}}")
	if got != "t_abc" {
		t.Fatalf("id = %q", got)
	}
	if ottyCreatedTabID("not json") != "" || ottyAppPath("/Applications/Otty.app/Contents/MacOS/otty-cli") != "/Applications/Otty.app" {
		t.Fatal("parse or app path")
	}
}

func TestLookupInstalled1Agent(t *testing.T) {
	info, ok := lookupMacApp("1Agent")
	if !ok {
		t.Skip("1Agent is not installed")
	}
	if !isOneAgent(info) {
		t.Fatalf("installed 1Agent is not com.itjun.1agent: %+v", info)
	}
}

func TestLookupInstalledOttyIsOfficial(t *testing.T) {
	info, ok := lookupMacApp("Otty")
	if !ok {
		t.Skip("Otty is not installed")
	}
	if !isOfficialOtty(info) {
		t.Fatalf("installed Otty is not the official app: %+v", info)
	}
}

func TestLookupInstalledGhosttyIsOfficial(t *testing.T) {
	info, ok := lookupMacApp("Ghostty")
	if !ok {
		t.Skip("Ghostty is not installed")
	}
	if !isOfficialGhostty(info) {
		t.Fatalf("installed Ghostty is not the official app: %+v", info)
	}
}

func TestMacTerminalScriptsCompile(t *testing.T) {
	if _, err := exec.LookPath("osacompile"); err != nil {
		t.Skip("osacompile not installed")
	}
	term, err := planMacOpen(macTerminalChoice{kind: macTerminalTerminal}, []string{"alpha"}, "window", "/usr/bin/ssh")
	if err != nil {
		t.Fatal(err)
	}
	tab, err := planMacOpen(macTerminalChoice{kind: macTerminalTerminal}, []string{"alpha"}, "tab", "/usr/bin/ssh")
	if err != nil {
		t.Fatal(err)
	}
	for _, script := range append(term.scripts, tab.scripts...) {
		cmd := exec.Command("osacompile", "-o", os.DevNull)
		cmd.Stdin = strings.NewReader(script)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("osacompile: %v\n%s\n%s", err, out, script)
		}
	}
}
