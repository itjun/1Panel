package updater

import (
	"regexp"
	"strings"

	"golang.org/x/mod/semver"
)

// git describe 在非 tag 提交上产出 v1.0.3-5-gabc1234，按 semver 会被当成 v1.0.3 的预发布版
// 而排在 v1.0.3 之前，因此单独识别为开发构建。
var describeSuffix = regexp.MustCompile(`-[0-9]+-g[0-9a-f]+$`)

// Canonical 补齐 v 前缀并去掉首尾空白。
func Canonical(v string) string {
	v = strings.TrimSpace(v)
	if v != "" && v[0] != 'v' {
		v = "v" + v
	}
	return v
}

// ParseCurrent 解析当前构建版本，返回可比较的基础版本以及是否为开发构建。
// ok=false 表示无法比较（如「开发构建」或提交短 SHA）。
func ParseCurrent(v string) (base string, dev bool, ok bool) {
	v = Canonical(v)
	if strings.HasSuffix(v, "-dirty") {
		v = strings.TrimSuffix(v, "-dirty")
		dev = true
	}
	if loc := describeSuffix.FindStringIndex(v); loc != nil {
		v = v[:loc[0]]
		dev = true
	}
	if !semver.IsValid(v) {
		return "", true, false
	}
	return v, dev, true
}

// Decision 版本判定结果。
type Decision struct {
	HasUpdate bool
	Mandatory bool
}

// Evaluate 判定是否有新版本，以及当前版本是否已低于最低支持版本。
// 开发构建永不强制，避免拦住本地调试。
func Evaluate(current string, dev bool, m *Manifest) Decision {
	if m == nil || !semver.IsValid(current) || !semver.IsValid(m.Version) {
		return Decision{}
	}
	d := Decision{HasUpdate: semver.Compare(m.Version, current) > 0}
	if d.HasUpdate && !dev && semver.IsValid(m.MinSupportedVersion) &&
		semver.Compare(current, m.MinSupportedVersion) < 0 {
		d.Mandatory = true
	}
	return d
}
