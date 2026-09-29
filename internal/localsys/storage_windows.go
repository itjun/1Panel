//go:build windows

package localsys

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// defaultStorageRoots Windows 扫描根：用户目录与常见程序安装位置。
// 不扫整盘（Windows 系统目录文件数巨大且对「找出谁占空间」帮助小），
// 顶部容器容量仍按全部固定盘实时汇总。
func defaultStorageRoots() []string {
	home, _ := os.UserHomeDir()
	cands := []string{
		home,
		os.Getenv("ProgramFiles"),
		os.Getenv("ProgramFiles(x86)"),
		os.Getenv("ProgramData"),
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

// storageContainerSummary Windows：全部固定盘容量合计（实时读取）。
func storageContainerSummary() (total, used, avail uint64) {
	eachFixedDrive(func(root string, rootPtr *uint16) bool {
		var freeCaller, t, f uint64
		if err := windows.GetDiskFreeSpaceEx(rootPtr, &freeCaller, &t, &f); err == nil {
			total += t
			used += t - f
			avail += f
		}
		return true
	})
	return total, used, avail
}

// statKey Windows：FileInfo 无设备号 / inode 信息，返回恒定值
// （跨卷判断退化为恒同卷；NTFS 硬链接极少，不做去重，避免逐文件打开句柄拖慢扫描）。
func statKey(info os.FileInfo) (dev, ino uint64, nlink uint64) {
	return 0, 0, 1
}

// diskSizeOf Windows：逻辑大小即占用（无 st_blocks 概念；稀疏与压缩按逻辑尺寸计）。
func diskSizeOf(info os.FileInfo) uint64 {
	if info.Size() < 0 {
		return 0
	}
	return uint64(info.Size())
}

func StorageReveal(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("路径为空")
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("路径不存在: %w", err)
	}
	// explorer /select 要求反斜杠路径；独立参数传递，不经 shell 拼接
	return exec.Command("explorer.exe", "/select,"+filepath.Clean(path)).Start()
}

func StorageOpenPrivacy() error {
	// Windows 无「完全磁盘访问」类隐私开关；此入口仅 macOS 提供。
	return errors.New("Windows 不需要此设置")
}

// ---- 应用归并：注册表 Uninstall 项 + 安装目录占用 ----

type winAppMeta struct {
	Name     string
	KeyName  string
	Location string
	EstKB    uint64
}

func buildStorageApps(dirSize func(string) uint64, fileSize func(string) uint64) []StorageApp {
	metas := listRegistryApps()
	var apps []StorageApp
	for _, m := range metas {
		bundle := uint64(0)
		if m.Location != "" {
			bundle = dirSize(m.Location)
			if bundle == 0 {
				bundle = quickDirSize(m.Location)
			}
		}
		if bundle == 0 {
			// 安装目录不在扫描根（或已卸载残留），退回注册表估算值
			bundle = m.EstKB * 1024
		}
		if bundle == 0 {
			continue
		}
		apps = append(apps, StorageApp{
			Name:       m.Name,
			BundleID:   m.KeyName,
			Path:       m.Location,
			BundleSize: bundle,
			DataSize:   0,
			Total:      bundle,
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

func listRegistryApps() []winAppMeta {
	type source struct {
		root registry.Key
		path string
	}
	sources := []source{
		{registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`},
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`},
		{registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`},
	}
	var out []winAppMeta
	seenName := map[string]bool{}
	for _, src := range sources {
		k, err := registry.OpenKey(src.root, src.path, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		names, err := k.ReadSubKeyNames(-1)
		if err != nil {
			k.Close()
			continue
		}
		for _, name := range names {
			m, ok := readRegistryApp(k, name)
			if !ok {
				continue
			}
			if seenName[m.Name] {
				continue
			}
			seenName[m.Name] = true
			out = append(out, m)
		}
		k.Close()
	}
	return out
}

func readRegistryApp(parent registry.Key, sub string) (winAppMeta, bool) {
	sk, err := registry.OpenKey(parent, sub, registry.QUERY_VALUE)
	if err != nil {
		return winAppMeta{}, false
	}
	defer sk.Close()
	name, _, _ := sk.GetStringValue("DisplayName")
	name = strings.TrimSpace(name)
	if name == "" {
		return winAppMeta{}, false
	}
	if flag, _, err := sk.GetIntegerValue("SystemComponent"); err == nil && flag != 0 {
		return winAppMeta{}, false
	}
	if s, _, err := sk.GetStringValue("ParentKeyName"); err == nil && strings.TrimSpace(s) != "" {
		return winAppMeta{}, false
	}
	if s, _, err := sk.GetStringValue("ReleaseType"); err == nil && strings.TrimSpace(s) != "" {
		return winAppMeta{}, false
	}
	location, _, _ := sk.GetStringValue("InstallLocation")
	location = strings.TrimSpace(location)
	if location != "" && !filepath.IsAbs(location) {
		location = ""
	}
	var estKB uint64
	if v, _, err := sk.GetIntegerValue("EstimatedSize"); err == nil {
		estKB = v
	}
	return winAppMeta{Name: name, KeyName: sub, Location: location, EstKB: estKB}, true
}
