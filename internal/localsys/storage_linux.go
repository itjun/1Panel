//go:build linux

package localsys

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	gdisk "github.com/shirou/gopsutil/v4/disk"
)

// defaultStorageRoots Linux 扫描根：用户目录 + 常见安装与数据目录。
// /usr（系统包文件）不进扫描：体积大、几乎全是包管理器内容，软件列表页已覆盖。
func defaultStorageRoots() []string {
	home, _ := os.UserHomeDir()
	cands := []string{
		home,
		"/opt",
		"/usr/local",
		"/var",
		"/srv",
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

// storageContainerSummary Linux：根文件系统容量（与 macOS「APFS 容器合计」对应的容器口径）。
func storageContainerSummary() (total, used, avail uint64) {
	if u, err := gdisk.Usage("/"); err == nil {
		return u.Total, u.Used, u.Free
	}
	return 0, 0, 0
}

// statKey Linux：设备号 + inode + 硬链接数（硬链接去重与跨卷判断用）。
func statKey(info os.FileInfo) (dev, ino uint64, nlink uint64) {
	sys, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, 0, 0
	}
	return uint64(sys.Dev), uint64(sys.Ino), uint64(sys.Nlink)
}

// diskSizeOf Linux：按分配块计占用（st_blocks × 512）。
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

// StorageReveal Linux：优先 D-Bus FileManager1（文件管理器定位并选中），回退 xdg-open 父目录。
func StorageReveal(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return os.ErrInvalid
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	url := "file://" + abs
	if err := exec.Command("dbus-send", "--print-reply", "--dest=org.freedesktop.FileManager1",
		"/org/freedesktop/FileManager1", "org.freedesktop.FileManager1.ShowItems",
		"array:string:"+url, "string:").Run(); err == nil {
		return nil
	}
	if err := exec.Command("gdbus", "call", "--session",
		"--dest", "org.freedesktop.FileManager1",
		"--object-path", "/org/freedesktop/FileManager1",
		"--method", "org.freedesktop.FileManager1.ShowItems",
		"['"+url+"']", "''").Run(); err == nil {
		return nil
	}
	dir := abs
	if st, err := os.Stat(abs); err == nil && !st.IsDir() {
		dir = filepath.Dir(abs)
	}
	return exec.Command("xdg-open", dir).Start()
}

// StorageOpenPrivacy Linux：无系统级「完全磁盘访问」开关（按钮仅 macOS 显示）。
func StorageOpenPrivacy() error {
	return nil
}

// ---- 应用归并：.desktop 入口 + XDG 数据目录 ----

type appMeta struct {
	Name     string
	BundleID string // .desktop 文件名（应用 id）
	Exec     string
	Path     string // .desktop 文件路径
}

func buildStorageApps(dirSize func(string) uint64, fileSize func(string) uint64) []StorageApp {
	metas := listLinuxAppMetas()
	var apps []StorageApp
	for _, m := range metas {
		parts := collectAppPartsLinux(m, dirSize, fileSize)
		var data uint64
		var kept []StorageAppPart
		seen := map[string]bool{}
		for _, p := range parts {
			if p.Size == 0 || seen[p.Path] {
				continue
			}
			seen[p.Path] = true
			data += p.Size
			kept = append(kept, p)
		}
		if data == 0 {
			continue
		}
		apps = append(apps, StorageApp{
			Name:       m.Name,
			BundleID:   m.BundleID,
			Path:       m.Path,
			BundleSize: 0, // Linux 无 bundle，程序本体分散在 /usr，已由目录树覆盖
			DataSize:   data,
			Total:      data,
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

// collectAppPartsLinux 按应用 id 与可执行名找数据目录：
// XDG 标准位置（config / cache / local share）、Flatpak 数据、旧式点目录（如 ~/.mozilla）。
func collectAppPartsLinux(m appMeta, dirSize func(string) uint64, fileSize func(string) uint64) []StorageAppPart {
	home, _ := os.UserHomeDir()
	if home == "" {
		return nil
	}
	keys := []string{m.BundleID}
	if base := execBaseOf(m.Exec); base != "" && base != m.BundleID {
		keys = append(keys, base)
	}
	var parts []StorageAppPart
	addDir := func(label, p string) {
		if p == "" {
			return
		}
		parts = append(parts, StorageAppPart{Label: label, Path: p, Size: dirSize(p)})
	}
	for _, key := range keys {
		addDir("配置", filepath.Join(home, ".config", key))
		addDir("缓存", filepath.Join(home, ".cache", key))
		addDir("数据", filepath.Join(home, ".local", "share", key))
		addDir("Flatpak 数据", filepath.Join(home, ".var", "app", key))
		addDir("用户目录", filepath.Join(home, "."+key))
	}
	return parts
}

func execBaseOf(execLine string) string {
	fields := strings.Fields(strings.TrimSpace(execLine))
	for _, f := range fields {
		if strings.HasPrefix(f, "-") || strings.Contains(f, "=") {
			continue // 跳过 env 赋值与选项，取第一个真参数
		}
		return strings.TrimSuffix(filepath.Base(f), ".sh")
	}
	return ""
}

// listLinuxAppMetas 扫系统与用户的应用入口（含 Flatpak 导出）。
func listLinuxAppMetas() []appMeta {
	home, _ := os.UserHomeDir()
	var dirs []string
	if home != "" {
		dirs = append(dirs, filepath.Join(home, ".local", "share", "applications"))
	}
	dirs = append(dirs, "/var/lib/flatpak/exports/share/applications",
		filepath.Join("/root", ".local", "share", "applications"))
	dirs = append(dirs, "/usr/local/share/applications", "/usr/share/applications")

	var out []appMeta
	seen := map[string]bool{}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".desktop") {
				continue
			}
			id := strings.TrimSuffix(e.Name(), ".desktop")
			full := filepath.Join(dir, e.Name())
			if seen[id] {
				continue
			}
			b, err := os.ReadFile(full)
			if err != nil {
				continue
			}
			entry := ParseDesktopEntry(string(b))
			if entry.NoDisplay {
				continue
			}
			name := entry.Name
			if entry.NameZhCN != "" {
				name = entry.NameZhCN
			}
			if name == "" {
				name = id
			}
			seen[id] = true
			out = append(out, appMeta{Name: name, BundleID: id, Exec: entry.Exec, Path: full})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
