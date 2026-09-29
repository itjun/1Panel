//go:build darwin

package localsys

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

// defaultStorageRoots macOS 扫描根：用户目录、应用与常见安装位置。
func defaultStorageRoots() []string {
	home, _ := os.UserHomeDir()
	cands := []string{
		home,
		"/Applications",
		"/Library",
		"/opt/homebrew",
		"/usr/local",
	}
	var out []string
	seen := map[string]bool{}
	for _, c := range cands {
		if c == "" {
			continue
		}
		c = filepath.Clean(c)
		if seen[c] {
			continue
		}
		st, err := os.Lstat(c)
		if err != nil || !st.IsDir() {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	return out
}

// storageContainerSummary 容器容量取 APFS 容器合计；
// 只算本机内置物理盘：磁盘映像（cryptex / 模拟器）与外置盘不计入。
func storageContainerSummary() (total, used, avail uint64) {
	containers := listAPFSContainers()
	var need []string
	for _, d := range containers {
		need = append(need, d.Parent)
	}
	kinds := cachedWholeDiskKinds(need)
	for _, d := range containers {
		if !isPhysicalWholeDisk(kinds, d.Parent) || isExternalWholeDisk(kinds, d.Parent) {
			continue
		}
		total += d.Total
		used += d.Used
		avail += d.Avail
	}
	return
}

// statKey macOS：设备号 + inode + 硬链接数（硬链接去重与跨卷判断用）。
func statKey(info os.FileInfo) (dev, ino uint64, nlink uint64) {
	sys, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, 0, 0
	}
	return uint64(sys.Dev), uint64(sys.Ino), uint64(sys.Nlink)
}

// diskSizeOf macOS：按分配块计占用（st_blocks × 512）。
func diskSizeOf(info os.FileInfo) uint64 {
	sys, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		if info.Size() < 0 {
			return 0
		}
		return uint64(info.Size())
	}
	return uint64(sys.Blocks) * 512
}

func StorageReveal(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return os.ErrInvalid
	}
	return exec.Command("open", "-R", path).Start()
}

func StorageOpenPrivacy() error {
	// 系统设置 → 隐私与安全性 → 完全磁盘访问权限
	return exec.Command("open", "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles").Start()
}

// ---- 应用归并：.app bundle + Containers/Caches 数据目录 ----

type appMeta struct {
	Name     string
	BundleID string
	Path     string
}

func buildStorageApps(dirSize func(string) uint64, fileSize func(string) uint64) []StorageApp {
	home, _ := os.UserHomeDir()
	metas := listAppBundles(home)
	var apps []StorageApp
	for _, m := range metas {
		parts := collectAppParts(home, m, dirSize, fileSize)
		var data uint64
		var kept []StorageAppPart
		for _, p := range parts {
			if p.Size == 0 {
				continue
			}
			data += p.Size
			kept = append(kept, p)
		}
		bundle := dirSize(m.Path)
		if bundle == 0 {
			// .app 在扫描根内应已有；缺失时轻量回退一次
			bundle = quickDirSize(m.Path)
		}
		total := bundle + data
		if total == 0 {
			continue
		}
		apps = append(apps, StorageApp{
			Name:       m.Name,
			BundleID:   m.BundleID,
			Path:       m.Path,
			BundleSize: bundle,
			DataSize:   data,
			Total:      total,
			Parts:      kept,
		})
	}
	sort.Slice(apps, func(i, j int) bool {
		if apps[i].Total != apps[j].Total {
			return apps[i].Total > apps[j].Total
		}
		return apps[i].Name < apps[j].Name
	})
	return apps
}

func collectAppParts(home string, m appMeta, dirSize, fileSize func(string) uint64) []StorageAppPart {
	var parts []StorageAppPart
	addDir := func(label, p string) {
		if p == "" {
			return
		}
		sz := dirSize(p)
		parts = append(parts, StorageAppPart{Label: label, Path: p, Size: sz})
	}
	addFile := func(label, p string) {
		sz := fileSize(p)
		parts = append(parts, StorageAppPart{Label: label, Path: p, Size: sz})
	}

	if m.BundleID != "" {
		addDir("Containers", filepath.Join(home, "Library", "Containers", m.BundleID))
		addDir("Application Support", filepath.Join(home, "Library", "Application Support", m.BundleID))
		addDir("Caches", filepath.Join(home, "Library", "Caches", m.BundleID))
		addDir("Saved State", filepath.Join(home, "Library", "Saved Application State", m.BundleID+".savedState"))
		addFile("Preferences", filepath.Join(home, "Library", "Preferences", m.BundleID+".plist"))
	}
	if m.Name != "" {
		addDir("Application Support", filepath.Join(home, "Library", "Application Support", m.Name))
		addDir("Caches", filepath.Join(home, "Library", "Caches", m.Name))
		addDir("Logs", filepath.Join(home, "Library", "Logs", m.Name))
	}

	// Group Containers：名称包含 bundleId
	gc := filepath.Join(home, "Library", "Group Containers")
	if ents, err := os.ReadDir(gc); err == nil && m.BundleID != "" {
		for _, e := range ents {
			if !e.IsDir() {
				continue
			}
			n := e.Name()
			if strings.Contains(n, m.BundleID) {
				addDir("Group Containers", filepath.Join(gc, n))
			}
		}
	}

	// 去重同 path
	seen := map[string]bool{}
	var out []StorageAppPart
	for _, p := range parts {
		if seen[p.Path] {
			continue
		}
		seen[p.Path] = true
		out = append(out, p)
	}
	return out
}

func listAppBundles(home string) []appMeta {
	var roots []string
	roots = append(roots, "/Applications")
	if home != "" {
		roots = append(roots, filepath.Join(home, "Applications"))
	}
	var out []appMeta
	seen := map[string]bool{}
	for _, root := range roots {
		ents, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range ents {
			name := e.Name()
			full := filepath.Join(root, name)
			if strings.HasSuffix(name, ".app") && e.IsDir() {
				if m, ok := readAppMeta(full); ok && !seen[m.Path] {
					seen[m.Path] = true
					out = append(out, m)
				}
				continue
			}
			// 一层子目录（如 /Applications/Utilities）
			if !e.IsDir() {
				continue
			}
			sub, err := os.ReadDir(full)
			if err != nil {
				continue
			}
			for _, s := range sub {
				if strings.HasSuffix(s.Name(), ".app") && s.IsDir() {
					ap := filepath.Join(full, s.Name())
					if m, ok := readAppMeta(ap); ok && !seen[m.Path] {
						seen[m.Path] = true
						out = append(out, m)
					}
				}
			}
		}
	}
	return out
}

func readAppMeta(appPath string) (appMeta, bool) {
	plist := filepath.Join(appPath, "Contents", "Info.plist")
	out, err := exec.Command("plutil", "-convert", "json", "-o", "-", plist).Output()
	name := strings.TrimSuffix(filepath.Base(appPath), ".app")
	meta := appMeta{Name: name, Path: appPath}
	if err != nil {
		return meta, true
	}
	var m map[string]any
	if json.Unmarshal(out, &m) != nil {
		return meta, true
	}
	if v, ok := m["CFBundleIdentifier"].(string); ok {
		meta.BundleID = v
	}
	if v, ok := m["CFBundleDisplayName"].(string); ok && v != "" {
		meta.Name = v
	} else if v, ok := m["CFBundleName"].(string); ok && v != "" {
		meta.Name = v
	}
	return meta, true
}
