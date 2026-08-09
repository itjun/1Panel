package sshconfig

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// HostConfig 表示一个 SSH 主机配置条目
type HostConfig struct {
	Name         string `json:"name"`          // Host 名称（别名）
	HostName     string `json:"hostName"`      // 实际主机/IP
	User         string `json:"user"`          // 登录用户
	Port         string `json:"port"`          // 端口（默认 22）
	IdentityFile string `json:"identityFile"`  // 密钥路径
	ProxyJump    string `json:"proxyJump"`     // 跳板机
	HostKeyAlgos string `json:"hostKeyAlgos"`  // 原文保留（部分场景需要）
}

// ConfigPath 返回 ~/.ssh/config 的绝对路径
func ConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("无法获取用户主目录: %w", err)
	}
	return filepath.Join(home, ".ssh", "config"), nil
}

// Parse 解析 ~/.ssh/config 文件，返回所有 Host 条目
// 行为说明：
//   - 跳过以 # 开头的注释行和空行
//   - 一个 Host 行可能包含多个别名（"Host a b c"），分别展开为独立条目
//   - 通配符（如 Host *）会被忽略，避免污染列表
//   - 字段大小写不敏感，按 ssh_config 规范
func Parse() ([]HostConfig, error) {
	path, err := ConfigPath()
	if err != nil {
		return nil, err
	}
	return ParseFile(path)
}

func ParseFile(path string) ([]HostConfig, error) {
	f, err := os.Open(path)
	if err != nil {
		// ~/.ssh/config 不存在时返回空列表而不是错误，让前端能正常启动
		if os.IsNotExist(err) {
			return []HostConfig{}, nil
		}
		return nil, fmt.Errorf("打开 ssh config 失败: %w", err)
	}
	defer f.Close()

	var hosts []HostConfig
	var current *HostConfig
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// 拆分 key value（支持空格或等号分隔）
		key, value, ok := splitField(line)
		if !ok {
			continue
		}
		key = strings.ToLower(key)

		switch key {
		case "host":
			// 一个 Host 行可能有多个别名，分别建条目
			for _, name := range strings.Fields(value) {
				if strings.Contains(name, "*") {
					continue
				}
				host := &HostConfig{Name: name}
				hosts = append(hosts, *host)
				current = &hosts[len(hosts)-1]
			}
		case "hostname":
			if current != nil {
				current.HostName = value
			}
		case "user":
			if current != nil {
				current.User = value
			}
		case "port":
			if current != nil {
				current.Port = value
			}
		case "identityfile":
			if current != nil {
				current.IdentityFile = expandPath(value)
			}
		case "proxyjump":
			if current != nil {
				current.ProxyJump = value
			}
		case "hostkeyalgorithms":
			if current != nil {
				current.HostKeyAlgos = value
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取 ssh config 失败: %w", err)
	}
	return hosts, nil
}

// splitField 把 "HostName 127.0.0.1" 或 "HostName=127.0.0.1" 拆成 key, value
func splitField(line string) (string, string, bool) {
	// 优先匹配等号
	if idx := strings.Index(line, "="); idx > 0 {
		k := strings.TrimSpace(line[:idx])
		v := strings.TrimSpace(line[idx+1:])
		return k, v, true
	}
	// 否则按第一个空格切
	idx := strings.IndexAny(line, " \t")
	if idx <= 0 {
		return "", "", false
	}
	return strings.TrimSpace(line[:idx]), strings.TrimSpace(line[idx+1:]), true
}

func expandPath(p string) string {
	if strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}
