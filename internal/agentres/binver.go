package agentres

import (
	"bytes"
	"debug/buildinfo"
	"strings"
)

// BinaryBuildVersion 从交叉编译产物的 buildinfo ldflags 读 -X main.version。
// 读不到返回空串（占位文件、非 Go 二进制）。
func BinaryBuildVersion(b []byte) string {
	if len(b) < 64 {
		return ""
	}
	bi, err := buildinfo.Read(bytes.NewReader(b))
	if err != nil {
		return ""
	}
	for _, s := range bi.Settings {
		if s.Key != "-ldflags" {
			continue
		}
		if v := parseVersionFromLdflags(s.Value); v != "" {
			return v
		}
	}
	return ""
}

func parseVersionFromLdflags(flags string) string {
	const p = "main.version="
	i := strings.Index(flags, p)
	if i < 0 {
		return ""
	}
	rest := strings.TrimSpace(flags[i+len(p):])
	if rest == "" {
		return ""
	}
	if f := strings.Fields(rest); len(f) > 0 {
		rest = f[0]
	}
	return strings.Trim(rest, `"'`)
}
