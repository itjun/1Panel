package monitor

import (
	"regexp"
	"strings"

	"diteng-pannel/internal/sshd"
)

// RuntimeInfo 常用运行环境的识别结果（未安装时 Version/Path 为空）
type RuntimeInfo struct {
	Name    string `json:"name"`    // java / go / python / node / bun
	Version string `json:"version"` // 提取的版本号，如 17.0.2
	Path    string `json:"path"`    // 可执行文件绝对路径
	Detail  string `json:"detail"`  // 版本命令原始输出首行（悬浮查看）
}

// CollectRuntimes 识别常用运行环境（java/go/python/node/bun）
// 一次 SSH 往返全部探测：command -v 定位可执行文件，再跑对应版本命令
// 非交互 SSH 不加载 ~/.bashrc，bun（~/.bun/bin）等常不在 PATH，
// 因此 PATH 找不到时回退探测各环境的常见安装位置
// python 优先 python3，缺失时回退 python
func (c *Collector) CollectRuntimes(host string, opt sshd.ConnectOption) ([]RuntimeInfo, error) {
	// 包一层 sh -c：zsh 下通配符无匹配会直接终止脚本，sh 只会保留字面量
	script := `sh -c 'for c in java go python3 python node bun; do
  echo "=$c="
  p=$(command -v "$c" 2>/dev/null)
  if [ -z "$p" ]; then
    case $c in
      bun)
        for alt in "$HOME/.bun/bin/bun"; do [ -x "$alt" ] && p="$alt" && break; done;;
      go)
        for alt in /usr/local/go/bin/go "$HOME/go/bin/go" /opt/go/bin/go; do [ -x "$alt" ] && p="$alt" && break; done;;
      node)
        for alt in /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do [ -x "$alt" ] && p="$alt" && break; done;;
      java)
        for alt in /usr/lib/jvm/*/bin/java "$HOME"/.sdkman/candidates/java/*/bin/java /usr/local/jdk*/bin/java; do [ -x "$alt" ] && p="$alt" && break; done;;
    esac
  fi
  [ -n "$p" ] || continue
  echo "path=$p"
  case $c in
    java) v=$("$p" -version 2>&1 | head -n1);;
    go) v=$("$p" version 2>/dev/null | head -n1);;
    *) v=$("$p" --version 2>/dev/null | head -n1);;
  esac
  echo "ver=$v"
done'`
	out, err := c.mgr.Run(host, opt, script)
	if err != nil {
		return nil, err
	}
	found := parseRuntimes(string(out))

	// python：python3 优先，缺失时用 python；展示名统一为 python
	py := found["python3"]
	if py == nil {
		py = found["python"]
	}

	list := make([]RuntimeInfo, 0, 5)
	for _, name := range []string{"java", "go", "python", "node", "bun"} {
		if name == "python" {
			if py != nil {
				list = append(list, *py)
			} else {
				list = append(list, RuntimeInfo{Name: "python"})
			}
			continue
		}
		if r, ok := found[name]; ok {
			list = append(list, *r)
		} else {
			list = append(list, RuntimeInfo{Name: name})
		}
	}
	return list, nil
}

// parseRuntimes 解析 "=java=" 分段输出，返回 name -> 信息
func parseRuntimes(s string) map[string]*RuntimeInfo {
	out := map[string]*RuntimeInfo{}
	lines := strings.Split(s, "\n")
	var cur *RuntimeInfo
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "=") && strings.HasSuffix(line, "=") && len(line) > 2 {
			name := strings.Trim(line, "=")
			cur = &RuntimeInfo{Name: name}
			out[name] = cur
			continue
		}
		if cur == nil {
			continue
		}
		if v, ok := strings.CutPrefix(line, "path="); ok {
			cur.Path = strings.TrimSpace(v)
		} else if v, ok := strings.CutPrefix(line, "ver="); ok {
			cur.Detail = strings.TrimSpace(v)
			cur.Version = extractVersion(cur.Name, cur.Detail)
		}
	}
	return out
}

// javaQuotedRe 匹配 java -version 输出里引号中的版本，如 openjdk version "17.0.2" 2022-01-18
var javaQuotedRe = regexp.MustCompile(`"([^"]+)"`)

// goVerRe 匹配 go version 输出，如 go version go1.21.5 linux/arm64
var goVerRe = regexp.MustCompile(`go(\d+(?:\.\d+)*)`)

// numVerRe 匹配裸版本号输出（node 的 v18.16.0 / python 的 Python 3.11.4 / bun 的 1.0.0）
var numVerRe = regexp.MustCompile(`\d+(?:\.\d+){0,3}`)

// extractVersion 从版本命令原始输出中提取可读版本号
func extractVersion(name, detail string) string {
	if detail == "" {
		return ""
	}
	switch name {
	case "java":
		// 优先取引号内完整版本（含 1.8.0_292 这类老格式），失败再退化数字正则
		if m := javaQuotedRe.FindStringSubmatch(detail); len(m) > 1 {
			return m[1]
		}
		return numVerRe.FindString(detail)
	case "python3", "python":
		return numVerRe.FindString(detail)
	case "go":
		if m := goVerRe.FindStringSubmatch(detail); len(m) > 1 {
			return m[1]
		}
		return ""
	default:
		// node / bun
		return numVerRe.FindString(detail)
	}
}
