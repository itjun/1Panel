package main

import (
	"context"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"

	"github.com/pkg/sftp"
)

// System 系统服务：内置脚本上传 / 窗口控制等
// SetTrafficLightsHidden 见 system.go
type System App

// bootstrapZshScript 是内置的 zsh 环境初始化脚本,编译期嵌入二进制。
// 脚本本体维护在 scripts/bootstrap-zsh.sh,可独立 scp 使用,也供此方法复用。
//
//go:embed scripts/bootstrap-zsh.sh
var bootstrapZshScript []byte

// 内置完整 Oh My Zsh，版本与许可证见 scripts/oh-my-zsh。
// 上传前拼上 materialize_*，新主机不用访问 GitHub 也能解出框架。
//
//go:embed scripts/oh-my-zsh/oh-my-zsh.tar.gz
var ohMyZshArchive []byte

// Official plugin sources with fixed revisions, checksums and licenses.
//
//go:embed scripts/zsh-plugins/zsh-autosuggestions/zsh-autosuggestions.tar.gz
var zshAutosuggestionsArchive []byte

//go:embed scripts/zsh-plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.tar.gz
var zshSyntaxHighlightingArchive []byte

func zshInstallationScript() []byte {
	var b strings.Builder
	writeHereDoc := func(marker string, archive []byte) {
		b.WriteString("base64 -d <<'")
		b.WriteString(marker)
		b.WriteString("'\n")
		b.WriteString(base64.StdEncoding.EncodeToString(archive))
		b.WriteString("\n")
		b.WriteString(marker)
		b.WriteString("\n")
	}
	b.WriteString("materialize_oh_my_zsh() {\n")
	writeHereDoc("ONEPANEL_OH_MY_ZSH", ohMyZshArchive)
	b.WriteString("}\nmaterialize_zsh_plugin() {\ncase \"$1\" in\n")
	for _, plugin := range []struct {
		name    string
		archive []byte
	}{
		{"zsh-autosuggestions", zshAutosuggestionsArchive},
		{"zsh-syntax-highlighting", zshSyntaxHighlightingArchive},
	} {
		b.WriteString(plugin.name)
		b.WriteString(")\n")
		writeHereDoc("ONEPANEL_ZSH_PLUGIN", plugin.archive)
		b.WriteString(";;\n")
	}
	b.WriteString("*) return 1 ;;\nesac\n}\n")
	return append([]byte(b.String()), bootstrapZshScript...)
}

// BootstrapZsh 把内置的 zsh 初始化脚本上传到远程主机 /tmp,返回远程路径。
// 兼容旧接口；新界面用 StartZshSetup 执行并自动清理脚本。
func (s *System) BootstrapZsh(host string) (string, error) {
	opt, err := (*App)(s).connectOptionFor(host)
	if err != nil {
		return "", err
	}
	client, err := s.sshMgr.GetClient(host, opt)
	if err != nil {
		return "", fmt.Errorf("连接失败: %w", err)
	}
	out, err := s.sshMgr.Run(host, opt, "mktemp /tmp/.1panel-zsh.XXXXXXXX", sshd.RunOptions{Timeout: 15 * time.Second})
	if err != nil {
		return "", fmt.Errorf("创建临时脚本失败: %w", err)
	}
	remotePath := strings.TrimSpace(string(out))
	if !strings.HasPrefix(remotePath, "/tmp/.1panel-zsh.") || strings.ContainsAny(remotePath, "\r\n") {
		return "", fmt.Errorf("远程临时路径异常")
	}
	success := false
	defer func() {
		if !success {
			_, _ = s.sshMgr.Run(host, opt, "rm -f -- "+zshShellQuote(remotePath))
		}
	}()
	sc, err := sftp.NewClient(client)
	if err != nil {
		return "", fmt.Errorf("SFTP 会话失败: %w", err)
	}
	defer sc.Close()
	f, err := sc.OpenFile(remotePath, os.O_WRONLY|os.O_TRUNC)
	if err != nil {
		return "", fmt.Errorf("上传脚本失败: %w", err)
	}
	if _, err := f.Write(zshInstallationScript()); err != nil {
		f.Close()
		return "", fmt.Errorf("写入脚本失败: %w", err)
	}
	if err := f.Close(); err != nil {
		return "", fmt.Errorf("关闭脚本失败: %w", err)
	}
	success = true
	return remotePath, nil
}

type ZshSetupOptions struct {
	BasePackages bool `json:"basePackages"`
	Highlighting bool `json:"highlighting"`
	Suggestions  bool `json:"suggestions"`
	Correction   bool `json:"correction"`
	DefaultShell bool `json:"defaultShell"`
}

// 已安装的插件文件和 1Panel 配置分开回报。
// Inspect 不 source 用户 rc，也不执行个人配置。
type ZshEnvironment struct {
	RestoreCommand      string `json:"restoreCommand"`
	OS                  string `json:"os"`
	Distribution        string `json:"distribution"`
	User                string `json:"user"`
	Home                string `json:"home"`
	Shell               string `json:"shell"`
	Manager             string `json:"manager"`
	Zshrc               string `json:"zshrc"`
	Zsh                 string `json:"zsh"`
	Theme               string `json:"theme"`
	OhMyZsh             bool   `json:"ohMyZsh"`
	OhMyZshRoot         string `json:"ohMyZshRoot"`
	Privileged          bool   `json:"privileged"`
	Git                 bool   `json:"git"`
	Highlighting        bool   `json:"highlighting"`
	Suggestions         bool   `json:"suggestions"`
	Managed             bool   `json:"managed"`
	HighlightingEnabled bool   `json:"highlightingEnabled"`
	SuggestionsEnabled  bool   `json:"suggestionsEnabled"`
	CorrectionEnabled   bool   `json:"correctionEnabled"`
	Supported           bool   `json:"supported"`
}

func zshBool(values map[string]string, key string) bool {
	return values[key] == "true"
}

func parseZshEnvironment(out string) ZshEnvironment {
	values := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if k, v, ok := strings.Cut(line, "="); ok {
			values[k] = strings.TrimSpace(v)
		}
	}
	env := ZshEnvironment{
		RestoreCommand: values["restoreCommand"],
		OS:             values["os"], Distribution: values["distribution"], User: values["user"],
		Home: values["home"], Shell: values["shell"], Manager: values["manager"],
		Zshrc: values["zshrc"], Zsh: values["zsh"], Theme: values["theme"], OhMyZshRoot: values["ohMyZshRoot"],
		Privileged: zshBool(values, "privileged"), OhMyZsh: zshBool(values, "ohMyZsh"),
		Git: zshBool(values, "git"), Highlighting: zshBool(values, "highlighting"),
		Suggestions: zshBool(values, "suggestions"), Managed: zshBool(values, "managed"),
		HighlightingEnabled: zshBool(values, "highlightingEnabled"),
		SuggestionsEnabled:  zshBool(values, "suggestionsEnabled"),
		CorrectionEnabled:   zshBool(values, "correctionEnabled"),
	}
	switch env.Manager {
	case "apt-get", "dnf", "yum", "apk":
		env.Supported = env.OS == "Linux"
	}
	return env
}

func (s *System) InspectZsh(host string) (ZshEnvironment, error) {
	opt, err := (*App)(s).connectOptionFor(host)
	if err != nil {
		return ZshEnvironment{}, err
	}
	out, err := s.sshMgr.Run(host, opt, "sh -s -- --inspect", sshd.RunOptions{Stdin: string(bootstrapZshScript), Timeout: 20 * time.Second})
	if err != nil {
		return ZshEnvironment{}, fmt.Errorf("检测 Shell 环境失败: %w", err)
	}
	env := parseZshEnvironment(string(out))
	if env.OS == "" || env.User == "" {
		return env, fmt.Errorf("远程主机未返回有效的 Shell 环境")
	}
	return env, nil
}

type ZshSetupTask struct {
	Host       string          `json:"host"`
	State      string          `json:"state"` // idle / running / success / error
	Options    ZshSetupOptions `json:"options"`
	Logs       []string        `json:"logs"`
	Error      string          `json:"error"`
	StartedAt  int64           `json:"startedAt"`
	FinishedAt int64           `json:"finishedAt"`
}

func zshShellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func appendZshSetupLog(task *ZshSetupTask, line string) {
	if len(task.Logs) >= 2000 {
		task.Logs = task.Logs[1:]
	}
	task.Logs = append(task.Logs, line)
}

func zshSetupErrorMessage(logs []string, err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "初始化已超时；请在目标主机终端确认远端任务状态后再重试。"
	}
	for i := len(logs) - 1; i >= 0; i-- {
		if message, ok := strings.CutPrefix(logs[i], "[错误] "); ok && strings.TrimSpace(message) != "" {
			return strings.TrimSpace(message)
		}
		if message, ok := strings.CutPrefix(logs[i], "E: "); ok {
			if strings.Contains(message, "Could not get lock") || strings.Contains(message, "Unable to acquire the dpkg frontend lock") || strings.Contains(message, "Unable to lock directory") {
				return "其他 APT/dpkg 任务仍在占用安装锁；请等待它完成后重新初始化。"
			}
			return "软件安装失败：" + message
		}
	}
	if err != nil {
		return err.Error()
	}
	return "初始化失败，请查看执行日志。"
}

func zshSetupCommand(path string, options ZshSetupOptions) string {
	args := " --apply"
	if options.BasePackages {
		args += " --base-packages"
	}
	if !options.Highlighting {
		args += " --no-highlighting"
	}
	if !options.Suggestions {
		args += " --no-suggestions"
	}
	if options.Correction {
		args += " --correction"
	} else {
		args += " --no-correction"
	}
	if options.DefaultShell {
		args += " --default-shell"
	}
	quoted := zshShellQuote(path)
	return "sh " + quoted + args + " 2>&1; result=$?; rm -f -- " + quoted + "; exit $result"
}

// StartHostSetup 安装 itjun-tools 基础软件，并打开全部 Shell 增强。
// 目标是 SSH 登录用户；个人配置先备份再保留。
func (s *System) StartHostSetup(host string) (ZshSetupTask, error) {
	return s.StartZshSetup(host, ZshSetupOptions{
		BasePackages: true, Highlighting: true, Suggestions: true, Correction: false, DefaultShell: true,
	})
}

const zshSetupTimeout = 30 * time.Minute

// StartZshSetup 关窗后继续跑。每台主机同时只有一个任务。
func (s *System) StartZshSetup(host string, options ZshSetupOptions) (ZshSetupTask, error) {
	env, err := s.InspectZsh(host)
	if err != nil {
		return ZshSetupTask{}, err
	}
	if !env.Supported {
		return ZshSetupTask{}, fmt.Errorf("仅支持使用 apt、dnf、yum、apk 的远程 Linux 主机")
	}
	needsGit := !env.Git // ys prompt and its official source require Git.
	if !env.Privileged && (env.Zsh == "" || needsGit || options.DefaultShell || options.BasePackages) {
		return ZshSetupTask{}, fmt.Errorf("安装依赖或切换默认 Shell 需要 root 或免密 sudo；请先在终端处理后重新检测")
	}
	opt, err := (*App)(s).connectOptionFor(host)
	if err != nil {
		return ZshSetupTask{}, err
	}
	s.zshSetupMu.Lock()
	if s.zshSetups == nil {
		s.zshSetups = make(map[string]*ZshSetupTask)
	}
	if task := s.zshSetups[host]; task != nil && task.State == "running" {
		s.zshSetupMu.Unlock()
		return ZshSetupTask{}, fmt.Errorf("该主机已有初始化任务正在运行")
	}
	task := &ZshSetupTask{Host: host, State: "running", Options: options, Logs: []string{"[准备] 连接主机并上传初始化脚本"}, StartedAt: time.Now().UnixMilli()}
	s.zshSetups[host] = task
	initial := *task
	initial.Logs = append([]string{}, task.Logs...)
	s.zshSetupMu.Unlock()
	go func() {
		appendLog := func(line string) {
			s.zshSetupMu.Lock()
			defer s.zshSetupMu.Unlock()
			appendZshSetupLog(task, line)
		}
		path, runErr := s.BootstrapZsh(host)
		if runErr == nil {
			ctx, cancel := context.WithTimeout(context.Background(), zshSetupTimeout)
			runErr = s.sshMgr.RunStream(ctx, host, opt, zshSetupCommand(path, options), appendLog)
			cancel()
			// On connection loss/timeout the remote shell may not reach its cleanup.
			_, _ = s.sshMgr.Run(host, opt, "rm -f -- "+zshShellQuote(path), sshd.RunOptions{Timeout: 10 * time.Second})
		}
		s.zshSetupMu.Lock()
		defer s.zshSetupMu.Unlock()
		task.FinishedAt = time.Now().UnixMilli()
		if runErr != nil {
			task.State, task.Error = "error", zshSetupErrorMessage(task.Logs, runErr)
			appendZshSetupLog(task, "[任务失败] "+task.Error)
		} else {
			task.State = "success"
		}
	}()
	return initial, nil
}

func (s *System) GetZshSetup(host string) ZshSetupTask {
	s.zshSetupMu.Lock()
	defer s.zshSetupMu.Unlock()
	if task := s.zshSetups[host]; task != nil {
		copy := *task
		copy.Logs = append([]string{}, task.Logs...)
		return copy
	}
	return ZshSetupTask{Host: host, State: "idle", Logs: []string{}}
}
