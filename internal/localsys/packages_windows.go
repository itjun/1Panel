//go:build windows

package localsys

import (
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows/registry"
)
var (
	pkgMu    sync.Mutex
	pkgCache []Package
	pkgAt    time.Time
)

// CollectPackages 列出「设置 → 应用」视角的已安装软件（注册表 Uninstall 键，
// 60s 缓存）。来源：system=64 位系统级、system32=32 位系统级、user=当前用户。
func CollectPackages() ([]Package, error) {
	pkgMu.Lock()
	defer pkgMu.Unlock()
	if time.Since(pkgAt) < 60*time.Second && pkgCache != nil {
		out := make([]Package, len(pkgCache))
		copy(out, pkgCache)
		return out, nil
	}
	var all []Package
	all = append(all, listUninstallKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`, "system")...)
	all = append(all, listUninstallKey(registry.LOCAL_MACHINE,
		`SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`, "system32")...)
	all = append(all, listUninstallKey(registry.CURRENT_USER,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`, "user")...)
	sort.Slice(all, func(i, j int) bool {
		if all[i].Name != all[j].Name {
			return all[i].Name < all[j].Name
		}
		return all[i].Path < all[j].Path
	})
	pkgCache = all
	pkgAt = time.Now()
	out := make([]Package, len(all))
	copy(out, all)
	return out, nil
}

func listUninstallKey(root registry.Key, path, source string) []Package {
	k, err := registry.OpenKey(root, path, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer k.Close()
	names, err := k.ReadSubKeyNames(-1)
	if err != nil {
		return nil
	}
	var out []Package
	for _, name := range names {
		item, ok := readUninstallEntry(k, name)
		if !ok {
			continue
		}
		out = append(out, Package{
			Name:    item.name,
			Version: item.version,
			Source:  source,
			Path:    item.location,
		})
	}
	return out
}

type uninstallEntry struct {
	name     string
	version  string
	location string
}

func readUninstallEntry(parent registry.Key, sub string) (uninstallEntry, bool) {
	sk, err := registry.OpenKey(parent, sub, registry.QUERY_VALUE)
	if err != nil {
		return uninstallEntry{}, false
	}
	defer sk.Close()
	name, _, _ := sk.GetStringValue("DisplayName")
	name = strings.TrimSpace(name)
	if name == "" {
		return uninstallEntry{}, false
	}
	// 系统组件 / 补丁不进入「已安装应用」列表
	if flag, _, err := sk.GetIntegerValue("SystemComponent"); err == nil && flag != 0 {
		return uninstallEntry{}, false
	}
	if s, _, err := sk.GetStringValue("ParentKeyName"); err == nil && strings.TrimSpace(s) != "" {
		return uninstallEntry{}, false
	}
	if s, _, err := sk.GetStringValue("ReleaseType"); err == nil && strings.TrimSpace(s) != "" {
		return uninstallEntry{}, false
	}
	version, _, _ := sk.GetStringValue("DisplayVersion")
	location, _, _ := sk.GetStringValue("InstallLocation")
	location = strings.TrimSpace(location)
	if location != "" && !filepath.IsAbs(location) {
		location = ""
	}
	return uninstallEntry{
		name:     name,
		version:  strings.TrimSpace(version),
		location: location,
	}, true
}
