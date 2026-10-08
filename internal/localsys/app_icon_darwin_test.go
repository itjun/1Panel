//go:build darwin && cgo

package localsys

import (
	"strings"
	"testing"
)

func TestAppIconSafari(t *testing.T) {
	url := AppIcon("/Applications/Safari.app")
	if !strings.HasPrefix(url, "data:image/png;base64,") {
		t.Fatalf("Safari 图标应为 PNG data URL，实际前缀 %.40q", url)
	}
}

func TestAppDisplayNameStripsSuffix(t *testing.T) {
	if name := appDisplayName("/Applications/Safari.app"); strings.HasSuffix(name, ".app") {
		t.Fatalf("显示名不应带 .app，实际 %q", name)
	}
}

func TestSortPackagesByName(t *testing.T) {
	pkgs := []Package{{Name: "微信"}, {Name: "Zed"}, {Name: "flomo"}, {Name: "企业微信"}, {Name: "Antigravity"}}
	sortPackagesByName(pkgs)
	var got []string
	for _, p := range pkgs {
		got = append(got, p.Name)
	}
	want := "Antigravity,flomo,Zed,企业微信,微信"
	if strings.Join(got, ",") != want {
		t.Fatalf("排序 = %v，期望 %s", got, want)
	}
}

func TestAppIconRejectsNonApp(t *testing.T) {
	if url := AppIcon("/etc/hosts"); url != "" {
		t.Fatalf("非 .app 路径应返回空串，实际 %.40q", url)
	}
}
