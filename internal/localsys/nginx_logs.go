package localsys

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"diteng-pannel/internal/prochide"
	"diteng-pannel/internal/regularfile"
)

type NginxLogResult struct {
	Source  string `json:"source"`
	Content string `json:"content"`
}

func detectNginxLogs(bin, conf string) (string, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "-V")
	prochide.Hide(cmd)
	output, _ := cmd.CombinedOutput()
	return nginxLogPaths(string(output), bin, conf, runtime.GOOS)
}

// 编译参数允许引号和带空格的安装路径，不执行输出中的命令。
func nginxBuildFlags(raw string) map[string]string {
	flags := map[string]string{}
	var word strings.Builder
	var quote rune
	flush := func() {
		if key, value, ok := strings.Cut(word.String(), "="); ok && strings.HasPrefix(key, "--") {
			flags[key] = value
		}
		word.Reset()
	}
	for _, c := range raw {
		if quote != 0 {
			if c == quote {
				quote = 0
			} else {
				word.WriteRune(c)
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
			continue
		}
		if c == ' ' || c == '\n' || c == '\t' {
			flush()
		} else {
			word.WriteRune(c)
		}
	}
	flush()
	return flags
}

func nginxLogPaths(raw, bin, conf, platform string) (string, string) {
	flags := nginxBuildFlags(raw)
	prefix := flags["--prefix"]
	if prefix == "" {
		if platform == "windows" {
			prefix = filepath.Dir(bin)
		} else {
			prefix = filepath.Dir(filepath.Dir(conf))
		}
	}
	fallback := "/var/log/nginx"
	if platform == "darwin" {
		switch {
		case strings.HasPrefix(bin, "/opt/homebrew/"):
			fallback = "/opt/homebrew/var/log/nginx"
		case strings.HasPrefix(bin, "/usr/local/"):
			fallback = "/usr/local/var/log/nginx"
		}
	} else if platform == "windows" {
		fallback = filepath.Join(filepath.Dir(bin), "logs")
	}
	resolve := func(flag, name string) string {
		path := flags[flag]
		if path == "" {
			return filepath.Join(fallback, name)
		}
		if !filepath.IsAbs(path) {
			path = filepath.Join(prefix, path)
		}
		return filepath.Clean(path)
	}
	return resolve("--http-log-path", "access.log"), resolve("--error-log-path", "error.log")
}

func ReadNginxLog(ctx context.Context, kind string, lines int) (NginxLogResult, error) {
	if kind != "nginx_access" && kind != "nginx_error" {
		return NginxLogResult{}, fmt.Errorf("不支持的 Nginx 日志类型")
	}
	if lines <= 0 || lines > 5000 {
		return NginxLogResult{}, fmt.Errorf("日志行数必须在 1 到 5000 之间")
	}
	info, err := CollectNginx()
	if err != nil {
		return NginxLogResult{}, err
	}
	if !info.Installed {
		return NginxLogResult{}, fmt.Errorf("未检测到 Nginx")
	}
	path := info.AccessLogPath
	if kind == "nginx_error" {
		path = info.ErrorLogPath
	}
	result := NginxLogResult{Source: path}
	result.Content, err = readLogTail(ctx, path, lines)
	if os.IsNotExist(err) {
		return result, fmt.Errorf("日志文件不存在：%s", path)
	}
	if os.IsPermission(err) {
		return result, fmt.Errorf("没有权限读取日志：%s", path)
	}
	return result, err
}

// 从文件末尾分块读取，固定本次长度，避免将持续增长的大日志全部载入内存。
func readLogTail(ctx context.Context, path string, lines int) (string, error) {
	file, err := regularfile.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return "", err
	}
	end := stat.Size()
	const limit = 8 << 20
	data := []byte{}
	for end > 0 {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		count := int64(64 << 10)
		if end < count {
			count = end
		}
		end -= count
		block := make([]byte, count)
		n, err := file.ReadAt(block, end)
		if err != nil && err != io.EOF {
			return "", err
		}
		if int64(n) != count {
			return "", fmt.Errorf("日志在读取期间被截断，请刷新重试")
		}
		data = append(block, data...)
		// 末尾换行不计为额外的空行。
		trimmed := bytes.TrimSuffix(data, []byte{'\n'})
		if bytes.Count(trimmed, []byte{'\n'}) >= lines || end == 0 {
			break
		}
		if len(data) >= limit {
			return "", fmt.Errorf("本次日志内容超过 8 MiB，请减少读取行数")
		}
	}
	data = bytes.TrimSuffix(data, []byte{'\n'})
	start := len(data)
	for i := 0; i < lines; i++ {
		at := bytes.LastIndexByte(data[:start], '\n')
		if at < 0 {
			return string(data), nil
		}
		start = at
	}
	return string(data[start+1:]), nil
}
