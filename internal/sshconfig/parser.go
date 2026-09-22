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
	Name          string `json:"name"`          // Host 名称（别名）
	HostName      string `json:"hostName"`      // 实际主机/IP
	User          string `json:"user"`          // 登录用户
	Port          string `json:"port"`          // 端口（默认 22）
	IdentityFile  string `json:"identityFile"`  // 密钥路径
	ProxyJump     string `json:"proxyJump"`     // 跳板机
	ProxyCommand  string `json:"proxyCommand"`  // 自定义代理命令（仅原文展示）
	IdentityAgent string `json:"identityAgent"` // SSH agent socket
	ForwardAgent  bool   `json:"forwardAgent"`  // agent 转发
	HostKeyAlgos  string `json:"hostKeyAlgos"`  // 原文保留（部分场景需要）
	// Note 本机备注：存 Application Support 的 host_meta.json，不写入 ~/.ssh/config；
	// 列表/导出时由 Hosts 服务合并进来。
	Note string `json:"note,omitempty"`
	// Password 本机保存的登录密码：仅备份导出/导入时出现在此结构体；
	// 不写入 ~/.ssh/config，也不随 ListHosts 下发。
	Password string `json:"password,omitempty"`
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
		case "proxycommand":
			if current != nil {
				current.ProxyCommand = value
			}
		case "identityagent":
			if current != nil {
				current.IdentityAgent = value
			}
		case "forwardagent":
			if current != nil {
				current.ForwardAgent = strings.EqualFold(value, "yes") || strings.EqualFold(value, "true")
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

// gitHostPatterns 是常见 Git 托管服务的域名
// 命中任一即视为 Git 服务条目，默认在主机列表中隐藏
var gitHostPatterns = []string{
	"github.com",
	"gitee.com",
	"gitlab.com",
	"bitbucket.org",
	"codeup.aliyun.com",
	"gitcode.com",
	"coding.net",
	"ssh.github.com",
}

// gitHostAliases 常见 Host 别名（无域名时）
var gitHostAliases = []string{
	"github",
	"gitee",
	"gitlab",
	"bitbucket",
}

// IsGitHost 判断一个 Host 条目是否是 Git 托管服务
// 判定规则（满足任一）：
//   - User == "git"
//   - HostName 或 Name 等于/后缀命中 git 域名
//   - Name 恰好为 github / gitee / gitlab / bitbucket
func IsGitHost(h HostConfig) bool {
	if strings.EqualFold(strings.TrimSpace(h.User), "git") {
		return true
	}
	if matchGitDomain(h.HostName) || matchGitDomain(h.Name) {
		return true
	}
	name := strings.ToLower(strings.TrimSpace(h.Name))
	for _, a := range gitHostAliases {
		if name == a {
			return true
		}
	}
	return false
}

func matchGitDomain(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return false
	}
	for _, p := range gitHostPatterns {
		if s == p || strings.HasSuffix(s, "."+p) {
			return true
		}
	}
	return false
}
