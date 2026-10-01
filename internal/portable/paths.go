// Package portable 定义跨平台主机配置迁移包（.zip）的格式与纯逻辑：
// 路径归一化、目标系统选项适配、zip 读写和 known_hosts 合并。
// 不依赖 App，便于在任意平台上单测。
package portable

import (
	"path"
	"strings"
)

// ExternalKeyDir 位于用户目录之外的私钥，迁移后统一落到此目录（相对 home）
const ExternalKeyDir = ".ssh/1panel-keys"

// NormalizePath 把 IdentityFile 一类路径改写为与平台无关的 `~/` 形式。
//
//   - `~/x`、`~\x`、`%d/x` 与相对路径（OpenSSH 按 home 解析）统一为 `~/x`
//   - 位于 home 下的绝对路径改写为 `~/相对路径`；Windows 盘符与大小写不敏感
//   - 其余绝对路径原样返回，inside=false，由调用方决定如何迁移
//
// 含其它 `%` 展开符（如 `%h`）的路径无法静态解析，原样返回且 inside=false。
func NormalizePath(p, home string) (normalized string, inside bool) {
	p = strings.TrimSpace(strings.Trim(strings.TrimSpace(p), "\"'"))
	if p == "" {
		return "", false
	}
	slashed := toSlash(p)
	switch {
	case slashed == "~":
		return "~", true
	case strings.HasPrefix(slashed, "~/"):
		return "~/" + cleanRel(slashed[2:]), true
	case strings.HasPrefix(slashed, "%d/"):
		return "~/" + cleanRel(slashed[3:]), true
	}
	if strings.Contains(slashed, "%") {
		return p, false
	}
	if !isAbs(slashed) {
		return "~/" + cleanRel(slashed), true
	}
	h := strings.TrimRight(toSlash(strings.TrimSpace(home)), "/")
	if h != "" {
		cp := path.Clean(slashed)
		if rel, ok := trimHomePrefix(cp, h); ok {
			if rel == "" {
				return "~", true
			}
			return "~/" + rel, true
		}
	}
	return p, false
}

// GuessSSHRelative 来源 home 未知时（旧版备份）的兜底：路径中含 `/.ssh/` 段时，
// 视为来源机器的 ~/.ssh 下文件，返回 `~/.ssh/...`。
func GuessSSHRelative(p string) (string, bool) {
	slashed := toSlash(strings.TrimSpace(p))
	idx := strings.LastIndex(slashed, "/.ssh/")
	if idx < 0 {
		return "", false
	}
	rest := cleanRel(slashed[idx+len("/.ssh/"):])
	if rest == "" || rest == "." {
		return "", false
	}
	return "~/.ssh/" + rest, true
}

// ExternalKeyPath 用户目录外私钥的迁移目标（`~/` 形式）
func ExternalKeyPath(base string) string {
	return "~/" + ExternalKeyDir + "/" + safeBase(base)
}

// RelFromTilde 把 `~/x` 转成相对 home 的 `x`；不是该形式时 ok=false
func RelFromTilde(p string) (string, bool) {
	if !strings.HasPrefix(p, "~/") {
		return "", false
	}
	rel := cleanRel(p[2:])
	if !SafeRel(rel) {
		return "", false
	}
	return rel, true
}

// SafeRel 校验相对路径不会越出根目录（zip 条目名与恢复目标共用）
func SafeRel(rel string) bool {
	if rel == "" || strings.Contains(rel, "\\") || strings.HasPrefix(rel, "/") || isAbs(rel) {
		return false
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == ".." || seg == "" {
			return false
		}
	}
	return true
}

func trimHomePrefix(p, home string) (string, bool) {
	caseless := hasDrive(home) || hasDrive(p)
	pp, hh := p, home
	if caseless {
		pp, hh = strings.ToLower(p), strings.ToLower(home)
	}
	if pp == hh {
		return "", true
	}
	if strings.HasPrefix(pp, hh+"/") {
		return p[len(home)+1:], true
	}
	return "", false
}

func toSlash(p string) string { return strings.ReplaceAll(p, "\\", "/") }

func cleanRel(p string) string {
	c := path.Clean("/" + p)
	return strings.TrimPrefix(c, "/")
}

func hasDrive(p string) bool {
	return len(p) >= 2 && p[1] == ':' && ((p[0] >= 'a' && p[0] <= 'z') || (p[0] >= 'A' && p[0] <= 'Z'))
}

func isAbs(p string) bool {
	return strings.HasPrefix(p, "/") || hasDrive(p) || strings.HasPrefix(p, "//")
}

func safeBase(name string) string {
	name = path.Base(toSlash(name))
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := strings.Trim(b.String(), ".")
	if out == "" {
		return "key"
	}
	return out
}
