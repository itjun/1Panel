package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/pkg/sftp"
)

const appLogMaxBytes = 512 * 1024

type AppLogRequest struct {
	PID          int    `json:"pid"`
	JarPath      string `json:"jarPath"`
	Port         int    `json:"port"`
	Screen       string `json:"screen"`
	ProcessStart string `json:"processStart"`
	Lines        int    `json:"lines"`
}

type AppLogResult struct {
	PID          int    `json:"pid"`
	Source       string `json:"source"`
	Content      string `json:"content"`
	ProcessStart string `json:"processStart"`
	Truncated    bool   `json:"truncated"`
}

// ReadAppLog 只读指定 JAR 实例的控制台日志。通过 SFTP 读取 /proc 和日志，
// 不执行远程命令，不依赖 agent 升级，也不回退到可能混有多个实例的 application.log。
func (s *Files) ReadAppLog(host string, req AppLogRequest) (AppLogResult, error) {
	var result AppLogResult
	err := s.withSFTP(host, func(sc *sftp.Client) error {
		var err error
		result, err = readAppLog(appLogSFTP{sc}, req)
		return err
	})
	return result, err
}

// 仅暴露读取能力；测试与 SFTP 共用同一套实例识别及限量读取逻辑。
type appLogFile interface {
	io.Reader
	io.Seeker
	io.Closer
	Stat() (os.FileInfo, error)
}

type appLogFS interface {
	Open(string) (appLogFile, error)
	ReadLink(string) (string, error)
	Stat(string) (os.FileInfo, error)
}

type appLogSFTP struct{ *sftp.Client }

func (fs appLogSFTP) Open(name string) (appLogFile, error) { return fs.Client.Open(name) }

func appLogReadSmall(fs appLogFS, name string) ([]byte, error) {
	f, err := fs.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 64*1024+1))
	if len(data) > 64*1024 {
		return nil, fmt.Errorf("进程信息过大")
	}
	return data, err
}

// stat 的 comm 可包含空格和括号；从最后一个右括号后解析 PPID / starttime。
func appLogIdentity(fs appLogFS, pid int) (parent int, start string, err error) {
	data, err := appLogReadSmall(fs, fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0, "", fmt.Errorf("进程 %d 已退出或无权读取，请刷新应用列表: %w", pid, err)
	}
	end := bytes.LastIndexByte(data, ')')
	if end < 0 {
		return 0, "", fmt.Errorf("无法识别进程 %d", pid)
	}
	fields := strings.Fields(string(data[end+1:]))
	if len(fields) < 20 {
		return 0, "", fmt.Errorf("进程 %d 状态不完整", pid)
	}
	parent, err = strconv.Atoi(fields[1])
	return parent, fields[19], err
}

func appLogArgs(fs appLogFS, pid int) ([]string, error) {
	data, err := appLogReadSmall(fs, fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return nil, err
	}
	return strings.Split(strings.TrimRight(string(data), "\x00"), "\x00"), nil
}

func appLogArg(args []string, name string) string {
	for i, arg := range args {
		if arg == name && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(arg, name+"=") {
			return strings.TrimPrefix(arg, name+"=")
		}
	}
	return ""
}

func appLogAbsolute(fs appLogFS, pid int, name string) (string, error) {
	if path.IsAbs(name) {
		return path.Clean(name), nil
	}
	cwd, err := fs.ReadLink(fmt.Sprintf("/proc/%d/cwd", pid))
	if err != nil {
		return "", err
	}
	return path.Join(cwd, name), nil
}

func readAppLog(fs appLogFS, req AppLogRequest) (AppLogResult, error) {
	result := AppLogResult{PID: req.PID}
	if req.PID <= 0 || req.JarPath == "" || req.Port < 0 || req.Port > 65535 {
		return result, fmt.Errorf("请选择具有有效 PID 和 JAR 路径的应用实例")
	}
	parent, start, err := appLogIdentity(fs, req.PID)
	if err != nil {
		return result, err
	}
	initialParent := parent
	if req.ProcessStart != "" && req.ProcessStart != start {
		return result, fmt.Errorf("进程 %d 已更换，请关闭日志并刷新应用列表", req.PID)
	}
	args, err := appLogArgs(fs, req.PID)
	if err != nil {
		return result, err
	}
	jar := appLogArg(args, "-jar")
	if jar == "" {
		return result, fmt.Errorf("进程 %d 已不是 JAR 应用，请刷新应用列表", req.PID)
	}
	jar, err = appLogAbsolute(fs, req.PID, jar)
	if err != nil {
		return result, err
	}
	expectedJar, err := appLogAbsolute(fs, req.PID, req.JarPath)
	if err != nil {
		return result, err
	}
	port := appLogArg(args, "--server.port")
	if jar != expectedJar || (req.Port > 0 && port != strconv.Itoa(req.Port)) {
		return result, fmt.Errorf("PID %d 的 JAR 或端口已变化，请刷新应用列表", req.PID)
	}

	// 从选定 PID 的父进程链找真实 screen -Logfile，避免猜文件名读到另一实例。
	for depth := 0; parent > 1 && depth < 8; depth++ {
		parentArgs, err := appLogArgs(fs, parent)
		if err != nil {
			return result, fmt.Errorf("无法读取日志会话: %w", err)
		}
		if len(parentArgs) > 0 && strings.EqualFold(path.Base(parentArgs[0]), "screen") {
			session := appLogArg(parentArgs, "-dmS")
			if session == "" {
				session = appLogArg(parentArgs, "-S")
			}
			if req.Screen != "" && session != req.Screen {
				return result, fmt.Errorf("PID %d 的 screen 会话已变化，请刷新应用列表", req.PID)
			}
			if source := appLogArg(parentArgs, "-Logfile"); source != "" {
				result.Source, err = appLogAbsolute(fs, parent, source)
				if err != nil {
					return result, err
				}
				break
			}
		}
		parent, _, err = appLogIdentity(fs, parent)
		if err != nil {
			return result, err
		}
	}
	if result.Source == "" {
		return result, fmt.Errorf("未找到 PID %d 独立的 screen 日志文件；未读取多进程共享日志", req.PID)
	}
	result.Content, result.Truncated, err = appLogTail(fs, result.Source, req.Lines)
	if err != nil {
		return result, fmt.Errorf("读取实例日志 %s 失败: %w", result.Source, err)
	}
	// 读取期间退出/重启时丢弃结果，刷新不会悄悄切到复用该 PID 的新进程。
	afterParent, after, err := appLogIdentity(fs, req.PID)
	if err != nil || after != start || afterParent != initialParent {
		return AppLogResult{}, fmt.Errorf("读取期间进程已退出或更换，请刷新应用列表")
	}
	result.ProcessStart = start
	return result, nil
}

func appLogTail(fs appLogFS, source string, lines int) (string, bool, error) {
	if lines <= 0 || lines > 5000 {
		lines = 500
	}
	info, err := fs.Stat(source)
	if err != nil {
		return "", false, err
	}
	if !info.Mode().IsRegular() {
		return "", false, fmt.Errorf("日志来源不是普通文件")
	}
	f, err := fs.Open(source)
	if err != nil {
		return "", false, err
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil {
		return "", false, err
	}
	if !info.Mode().IsRegular() {
		return "", false, fmt.Errorf("日志来源不是普通文件")
	}
	offset := max(int64(0), info.Size()-appLogMaxBytes)
	if _, err = f.Seek(offset, io.SeekStart); err != nil {
		return "", false, err
	}
	data, err := io.ReadAll(io.LimitReader(f, appLogMaxBytes))
	if err != nil {
		return "", false, err
	}
	if offset > 0 {
		if newline := bytes.IndexByte(data, '\n'); newline >= 0 {
			data = data[newline+1:]
		}
	}
	text := strings.ToValidUTF8(strings.ReplaceAll(string(data), "\r\n", "\n"), "�")
	rows := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	truncated := offset > 0 || len(rows) > lines
	if len(rows) > lines {
		rows = rows[len(rows)-lines:]
	}
	return strings.Join(rows, "\n"), truncated, nil
}
