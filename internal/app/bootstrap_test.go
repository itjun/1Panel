package app

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestZshEnvironmentParsing(t *testing.T) {
	env := parseZshEnvironment("os=Linux\ndistribution=Ubuntu 24.04 LTS\nuser=deploy\nhome=/home/deploy\nmanager=apt-get\nprivileged=true\nhighlighting=true\nmanaged=true\nhighlightingEnabled=true\nrestoreCommand=sh '/home/deploy/backups/restore.sh'\n")
	if !env.Supported || !env.Privileged || !env.Highlighting || !env.HighlightingEnabled || env.SuggestionsEnabled || env.User != "deploy" || env.RestoreCommand == "" {
		t.Fatalf("unexpected environment: %+v", env)
	}
	for _, output := range []string{"os=Darwin\nmanager=apt-get", "os=Linux\nmanager=pacman", "os=Linux"} {
		if parseZshEnvironment(output).Supported {
			t.Fatalf("unexpected support for %q", output)
		}
	}
}

func TestZshTaskSnapshotIsIndependent(t *testing.T) {
	s := &System{zshSetups: map[string]*ZshSetupTask{"alpha": {Host: "alpha", State: "running", Logs: []string{"original"}}}}
	snapshot := s.GetZshSetup("alpha")
	snapshot.Logs[0] = "changed"
	if s.GetZshSetup("alpha").Logs[0] != "original" {
		t.Fatal("caller can mutate task logs")
	}
	if s.GetZshSetup("beta").State != "idle" {
		t.Fatal("task leaked across hosts")
	}
}

func TestZshCommandQuotesAndPreservesExitStatus(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shell ' test.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 7\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", "-c", zshSetupCommand(path, ZshSetupOptions{}))
	if err := cmd.Run(); err == nil || err.(*exec.ExitError).ExitCode() != 7 {
		t.Fatalf("lost exit status: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("uploaded script not cleaned")
	}
}

func TestZshSetupErrorReportsAptLock(t *testing.T) {
	logs := []string{"E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 6241 (apt)", "E: Unable to acquire the dpkg frontend lock"}
	message := zshSetupErrorMessage(logs, errors.New("Process exited with status 100"))
	if !strings.Contains(message, "安装锁") || !strings.Contains(message, "等待") || strings.Contains(message, "status 100") {
		t.Fatalf("unhelpful installation error: %s", message)
	}
}

func TestZshSetupErrorUsesLatestFailure(t *testing.T) {
	logs := []string{
		"E: Could not get lock /var/lib/apt/lists/lock. It is held by process 123 (apt)",
		"[等待] 其他 APT 更新任务占用索引锁",
		"Reading package lists...",
		"[错误] 下载 zsh-autosuggestions 失败或超时，请检查网络后重试。",
	}
	if got := zshSetupErrorMessage(logs, errors.New("Process exited with status 1")); got != "下载 zsh-autosuggestions 失败或超时，请检查网络后重试。" {
		t.Fatalf("recovered lock hid the actual failure: %s", got)
	}
	if got := zshSetupErrorMessage(logs[:3], context.DeadlineExceeded); !strings.Contains(got, "超时") || strings.Contains(got, "安装锁") {
		t.Fatalf("timeout misreported as a lock error: %s", got)
	}
}

func TestZshBootstrapDefaultDisablesBothCorrectionOptions(t *testing.T) {
	f := newZshFixture(t)
	rc := filepath.Join(f.home, ".zshrc")
	original := "ENABLE_CORRECTION=true\nsetopt correct correctall\n"
	if err := os.WriteFile(rc, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	if out, err := f.run(t, "--apply"); err != nil {
		t.Fatalf("apply: %v\n%s", err, out)
	}
	cmd := exec.Command(f.zsh, "-dfi", "-c", `source "$1"; [[ ! -o correct && ! -o correctall && "$ZSH_THEME" == ys ]] && (( $+functions[_zsh_highlight] && $+functions[_zsh_autosuggest_start] ))`, "--", rc)
	cmd.Env = append(os.Environ(), "HOME="+f.home, "ZDOTDIR="+f.home, "TERM=xterm-256color")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("default setup left spell correction enabled: %v\n%s", err, out)
	}
	if !strings.HasPrefix(readZshFile(t, rc), original) {
		t.Fatal("personal configuration was removed")
	}
}

func TestZshBundledInstallationNeedsNoPluginNetwork(t *testing.T) {
	f := newZshFixture(t)
	if err := os.RemoveAll(filepath.Join(f.home, ".oh-my-zsh", "custom", "plugins")); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "uploaded-init.sh")
	if err := os.WriteFile(path, zshInstallationScript(testResources(t)), 0600); err != nil {
		t.Fatal(err)
	}
	if out, err := f.runPath(t, path, "--apply"); err != nil {
		t.Fatalf("embedded installation required plugin network: %v\n%s", err, out)
	}
	for _, plugin := range []string{"zsh-autosuggestions", "zsh-syntax-highlighting"} {
		if _, err := os.Stat(filepath.Join(f.home, ".local/share/1panel/zsh/plugins", plugin, plugin+".zsh")); err != nil {
			t.Fatalf("missing real plugin %s: %v", plugin, err)
		}
	}
}

func TestZshHostInitializationPackagesAndServiceFailure(t *testing.T) {
	for _, failService := range []bool{false, true} {
		t.Run(map[bool]string{false: "install", true: "service failure"}[failService], func(t *testing.T) {
			f := newZshFixture(t)
			f.stub(t, "id", `if [ "$1" = -u ]; then echo 0; else echo deploy; fi`)
			f.stub(t, "apt-get", `printf '%s\n' "$*" >> "$HOME/packages.log"`)
			body := `printf '%s\n' "$*" >> "$HOME/service.log"`
			if failService {
				body += "\nexit 1"
			}
			f.stub(t, "systemctl", body)
			rc := filepath.Join(f.home, ".zshrc")
			original := "export PATH=/personal/bin:$PATH\n"
			if err := os.WriteFile(rc, []byte(original), 0600); err != nil {
				t.Fatal(err)
			}
			out, err := f.run(t, "--apply", "--base-packages")
			if failService {
				if err == nil || !strings.Contains(out, "SSH 开机启动设置失败") || readZshFile(t, rc) != original {
					t.Fatalf("service failure not reported or rc changed: %v\n%s", err, out)
				}
			} else if err != nil {
				t.Fatalf("host installation failed: %v\n%s", err, out)
			}
			if got := readZshFile(t, filepath.Join(f.home, "packages.log")); got != "update\n-o DPkg::Lock::Timeout=300 install -y openssh-server vim curl wget sudo tree ca-certificates zsh git htop btop\n" {
				t.Fatalf("unexpected package operations: %s", got)
			}
			if got := readZshFile(t, filepath.Join(f.home, "service.log")); got != "enable ssh\n" {
				t.Fatalf("unexpected SSH operation: %s", got)
			}
			command := zshSetupCommand("/tmp/setup", ZshSetupOptions{BasePackages: true, Highlighting: true, Suggestions: true, Correction: false, DefaultShell: true})
			if !strings.Contains(command, "--base-packages") || !strings.Contains(command, "--default-shell") || !strings.Contains(command, "--no-correction") || strings.Contains(command, "--no-highlighting") || strings.Contains(command, "--no-suggestions") {
				t.Fatal("full setup flags incomplete")
			}
		})
	}
}

type zshFixture struct{ home, bin, zsh string }

func newZshFixture(t *testing.T) zshFixture {
	t.Helper()
	zsh, err := exec.LookPath("zsh")
	if err != nil {
		t.Skip("zsh is needed for isolated installer coverage")
	}
	root := t.TempDir()
	f := zshFixture{home: filepath.Join(root, "user ' home"), bin: filepath.Join(root, "bin"), zsh: zsh}
	for _, dir := range []string{f.home, f.bin} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	f.stub(t, "uname", "printf 'Linux\\n'")
	f.stub(t, "getent", `printf 'deploy:x:1000:1000::%s:/bin/bash\n' "$HOME"`)
	f.stub(t, "apt-get", "echo 'unexpected package installation' >&2; exit 88")
	f.stub(t, "sudo", "exit 1")
	f.stub(t, "git", "echo 'simulated network failure' >&2; exit 1")
	for plugin, content := range map[string]string{"zsh-autosuggestions": "_zsh_autosuggest_start() { :; }", "zsh-syntax-highlighting": "_zsh_highlight() { :; }"} {
		dir := filepath.Join(f.home, ".oh-my-zsh", "custom", "plugins", plugin)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, plugin+".zsh"), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f zshFixture) stub(t *testing.T, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(f.bin, name), []byte("#!/bin/sh\n"+body+"\n"), 0700); err != nil {
		t.Fatal(err)
	}
}

func (f zshFixture) run(t *testing.T, args ...string) (string, error) {
	return f.runPath(t, filepath.Join("..", "..", "scripts", "bootstrap-zsh.sh"), args...)
}

func (f zshFixture) runPath(t *testing.T, path string, args ...string) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", append([]string{path}, args...)...)
	cmd.Env = append(os.Environ(), "HOME="+f.home, "ZDOTDIR="+f.home, "ZSH=", "ZSH_CUSTOM=", "PATH="+f.bin+":"+os.Getenv("PATH"), "TERM=xterm-256color")
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func readZshFile(t *testing.T, path string) string {
	t.Helper()
	out, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func TestZshBootstrapPreservesConfigAndRestores(t *testing.T) {
	f := newZshFixture(t)
	rc := filepath.Join(f.home, ".zshrc")
	original := "export PATH=/my/bin:$PATH\nPROMPT='my prompt> '\nplugins=(svn)\nalias gst='personal status'\n# personal config\n"
	if err := os.WriteFile(rc, []byte(original), 0640); err != nil {
		t.Fatal(err)
	}
	out, err := f.run(t, "--apply")
	if err != nil {
		t.Fatalf("apply failed: %v\n%s", err, out)
	}
	first := readZshFile(t, rc)
	if !strings.HasPrefix(first, original) || strings.Count(first, "# >>> 1Panel zsh >>>") != 1 {
		t.Fatal("personal config lost or duplicate include")
	}
	if !strings.Contains(out, "[验证]") {
		t.Fatal("runtime validation missing")
	}
	if _, err := f.run(t, "--apply"); err != nil {
		t.Fatal(err)
	}
	if readZshFile(t, rc) != first {
		t.Fatal("repeat setup changed config")
	}
	info, _ := os.Stat(rc)
	if info.Mode().Perm() != 0640 {
		t.Fatal("rc permissions changed")
	}
	inspection, err := f.run(t, "--inspect")
	if err != nil {
		t.Fatal(err)
	}
	env := parseZshEnvironment(inspection)
	if !env.Managed || !env.OhMyZsh || env.CorrectionEnabled || !env.SuggestionsEnabled || !env.HighlightingEnabled || env.RestoreCommand == "" {
		t.Fatalf("inspection failed: %s", inspection)
	}
	// Full framework is loaded, rather than only prompt helpers. Existing
	// plugins and framework directories remain usable on repeated installation.
	framework := readZshFile(t, filepath.Join(env.OhMyZshRoot, "oh-my-zsh.sh"))
	if !strings.Contains(framework, "_omz_source") {
		t.Fatal("complete Oh My Zsh framework is missing")
	}
	cmd := exec.Command(f.zsh, "-dfi", "-c", `source "$1"; [[ "$plugins" == svn && "$aliases[gst]" == 'personal status' ]] && (( $+functions[omz] ))`, "--", rc)
	cmd.Env = append(os.Environ(), "HOME="+f.home, "ZDOTDIR="+f.home, "TERM=xterm-256color")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("framework lost personal plugins or aliases: %v\n%s", err, out)
	}
	cmd = exec.Command(f.zsh, "-dfi", "-c", `plugins=(); alias gst='personal status'; source "$1"; [[ "$aliases[gst]" == 'personal status' ]] && (( $plugins[(Ie)git] && $+functions[omz] ))`, "--", filepath.Join(f.home, ".local/share/1panel/zsh/setup.zsh"))
	cmd.Env = append(os.Environ(), "HOME="+f.home, "ZDOTDIR="+f.home, "TERM=xterm-256color")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("default Git plugin overwrote a personal alias: %v\n%s", err, out)
	}
	// Restore the first backup, including quote-containing paths and exact contents.
	restore := ""
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "[恢复命令] ") {
			restore = strings.TrimPrefix(line, "[恢复命令] ")
		}
	}
	if out, err := exec.Command("sh", "-c", restore).CombinedOutput(); err != nil {
		t.Fatalf("restore failed: %v %s", err, out)
	}
	if readZshFile(t, rc) != original {
		t.Fatal("restore lost original config")
	}
}

func TestZshBootstrapValidationFailureRollsBack(t *testing.T) {
	f := newZshFixture(t)
	rc := filepath.Join(f.home, ".zshrc")
	original := "# original config\n"
	if err := os.WriteFile(rc, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	f.stub(t, "zsh", `if [ "$1" = -dfi ]; then exit 9; fi; exec `+zshShellQuote(f.zsh)+` "$@"`)
	out, err := f.run(t, "--apply")
	if err == nil || !strings.Contains(out, "[恢复]") {
		t.Fatalf("expected rollback: %v %s", err, out)
	}
	if readZshFile(t, rc) != original {
		t.Fatal("validation failure overwrote rc")
	}
	if _, err := os.Stat(filepath.Join(f.home, ".local/share/1panel/zsh/setup.zsh")); !os.IsNotExist(err) {
		t.Fatal("failed configuration left behind")
	}
}

func TestZshBootstrapCorruptPluginDoesNotWriteConfig(t *testing.T) {
	f := newZshFixture(t)
	if err := os.RemoveAll(filepath.Join(f.home, ".oh-my-zsh")); err != nil {
		t.Fatal(err)
	}
	rc := filepath.Join(f.home, ".zshrc")
	original := "# original config\n"
	if err := os.WriteFile(rc, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "corrupt-init.sh")
	resources := testResources(t)
	payload := strings.Replace(string(zshInstallationScript(resources)), base64.StdEncoding.EncodeToString(resources.ZshAutosuggestions), base64.StdEncoding.EncodeToString([]byte("corrupted archive")), 1)
	if err := os.WriteFile(path, []byte(payload), 0600); err != nil {
		t.Fatal(err)
	}
	out, err := f.runPath(t, path, "--apply")
	if err == nil || !strings.Contains(out, "插件安装包校验失败") {
		t.Fatalf("corrupt archive was not rejected: %v %s", err, out)
	}
	if readZshFile(t, rc) != original {
		t.Fatal("corrupt archive overwrote rc")
	}
	if _, err := os.Stat(filepath.Join(f.home, ".local/share/1panel/zsh/.lock")); !os.IsNotExist(err) {
		t.Fatal("lock not cleaned")
	}
}

func TestZshBootstrapInspectIsReadOnlyAndRejectsBrokenMarkers(t *testing.T) {
	f := newZshFixture(t)
	rc := filepath.Join(f.home, ".zshrc")
	original := "# personal\n# >>> 1Panel zsh >>>\n# broken marker\n"
	if err := os.WriteFile(rc, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	if out, err := f.run(t, "--inspect"); err != nil {
		t.Fatalf("inspect: %v %s", err, out)
	}
	if _, err := os.Stat(filepath.Join(f.home, ".local")); !os.IsNotExist(err) {
		t.Fatal("inspection wrote files")
	}
	if out, err := f.run(t, "--apply"); err == nil {
		t.Fatalf("unmatched markers accepted: %s", out)
	}
	if readZshFile(t, rc) != original {
		t.Fatal("unmatched markers lost personal config")
	}
}
