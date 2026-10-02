//go:build linux

package localsys

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/prochide"
)

var (
	pkgMu    sync.Mutex
	pkgCache []Package
	pkgAt    time.Time
)

// CollectPackages 列出本机软件（60s 缓存）：
// 桌面应用（.desktop）、dpkg / rpm / pacman 包、Flatpak / Snap 应用。
// 按存在性探测各包管理器，互不依赖；source 对应前端筛选项。
func CollectPackages() ([]Package, error) {
	pkgMu.Lock()
	defer pkgMu.Unlock()
	if time.Since(pkgAt) < 60*time.Second && pkgCache != nil {
		out := make([]Package, len(pkgCache))
		copy(out, pkgCache)
		return out, nil
	}
	var all []Package
	all = append(all, listDesktopApps()...)
	all = append(all, listDpkgPackages()...)
	all = append(all, listRpmPackages()...)
	all = append(all, listPacmanPackages()...)
	all = append(all, listFlatpakApps()...)
	all = append(all, listSnapApps()...)
	pkgCache = all
	pkgAt = time.Now()
	out := make([]Package, len(all))
	copy(out, all)
	return out, nil
}

// listDesktopApps 扫桌面入口（.desktop），Name 取本地化名（如 Name[zh_CN]）优先。
func listDesktopApps() []Package {
	home, _ := os.UserHomeDir()
	var dirs []string
	if home != "" {
		dirs = append(dirs, filepath.Join(home, ".local", "share", "applications"))
	}
	dirs = append(dirs, "/usr/share/applications", "/usr/local/share/applications")
	seen := map[string]bool{}
	var out []Package
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".desktop") {
				continue
			}
			full := filepath.Join(dir, e.Name())
			if seen[full] {
				continue
			}
			b, err := os.ReadFile(full)
			if err != nil {
				continue
			}
			entry := ParseDesktopEntry(string(b))
			if entry.NoDisplay || entry.Name == "" {
				continue
			}
			seen[full] = true
			out = append(out, Package{
				Name:   entry.Name,
				Source: "app",
				Path:   full,
			})
		}
	}
	return out
}

// DesktopEntry .desktop 解析结果（供单测）。
type DesktopEntry struct {
	Name      string
	NameZhCN  string
	Exec      string
	Icon      string
	NoDisplay bool
}

// ParseDesktopEntry 解析 .desktop 主段（供单测）；Name[zh_CN] 单独取出，展示时优先。
func ParseDesktopEntry(raw string) DesktopEntry {
	var e DesktopEntry
	inDesktop := false
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			inDesktop = strings.Trim(line, "[]") == "Desktop Entry"
			continue
		}
		if !inDesktop {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "Name":
			e.Name = strings.TrimSpace(v)
		case "Name[zh_CN]":
			e.NameZhCN = strings.TrimSpace(v)
		case "Exec":
			e.Exec = strings.TrimSpace(v)
		case "Icon":
			e.Icon = strings.TrimSpace(v)
		case "NoDisplay":
			e.NoDisplay = strings.EqualFold(strings.TrimSpace(v), "true")
		}
	}
	return e
}

// listDpkgPackages dpkg（Debian / Ubuntu 系）。
func listDpkgPackages() []Package {
	out, err := runPkgCmd("dpkg-query", "-W", "-f=${binary:Package}\t${Version}\t${db:Status-Abbrev}\n")
	if err != nil {
		return nil
	}
	var pkgs []Package
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) < 3 || !strings.HasPrefix(fields[2], "ii") {
			continue
		}
		pkgs = append(pkgs, Package{Name: fields[0], Version: fields[1], Source: "dpkg", Path: "/var/lib/dpkg/status"})
	}
	return pkgs
}

// listRpmPackages rpm（Fedora / RHEL / openSUSE 系）。
func listRpmPackages() []Package {
	out, err := runPkgCmd("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n")
	if err != nil {
		return nil
	}
	var pkgs []Package
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) < 2 || fields[0] == "" {
			continue
		}
		pkgs = append(pkgs, Package{Name: fields[0], Version: fields[1], Source: "rpm", Path: "/var/lib/rpm"})
	}
	return pkgs
}

var pacmanDirRe = regexp.MustCompile(`^(.+)-([^-]+)-([^-]+)$`)

// listPacmanPackages pacman（Arch 系）：解析 /var/lib/pacman/local 的 desc 文件。
func listPacmanPackages() []Package {
	entries, err := os.ReadDir("/var/lib/pacman/local")
	if err != nil {
		return nil
	}
	var pkgs []Package
	for _, e := range entries {
		if !e.IsDir() || !pacmanDirRe.MatchString(e.Name()) {
			continue
		}
		b, err := os.ReadFile(filepath.Join("/var/lib/pacman/local", e.Name(), "desc"))
		if err != nil {
			continue
		}
		name, version := parsePacmanDesc(string(b))
		if name == "" {
			continue
		}
		pkgs = append(pkgs, Package{Name: name, Version: version, Source: "pacman", Path: "/var/lib/pacman/local"})
	}
	sort.Slice(pkgs, func(i, j int) bool { return pkgs[i].Name < pkgs[j].Name })
	return pkgs
}

// parsePacmanDesc 取 desc 里的 %NAME% / %VERSION% 段（供单测）。
func parsePacmanDesc(raw string) (name, version string) {
	key := ""
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "%") && strings.HasSuffix(line, "%") {
			key = strings.Trim(line, "%")
			continue
		}
		switch key {
		case "NAME":
			if name == "" {
				name = line
			}
		case "VERSION":
			if version == "" {
				version = line
			}
		}
	}
	return name, version
}

// listFlatpakApps Flatpak 应用（名称列 + 版本列）。
func listFlatpakApps() []Package {
	out, err := runPkgCmd("flatpak", "list", "--app", "--columns=name,version")
	if err != nil {
		return nil
	}
	var pkgs []Package
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		fields := strings.Split(strings.TrimRight(sc.Text(), "\t "), "\t")
		if len(fields) == 0 || fields[0] == "" || strings.HasPrefix(fields[0], "Name") {
			continue
		}
		ver := ""
		if len(fields) > 1 {
			ver = strings.TrimSpace(fields[1])
		}
		pkgs = append(pkgs, Package{Name: strings.TrimSpace(fields[0]), Version: ver, Source: "flatpak", Path: "/var/lib/flatpak"})
	}
	return pkgs
}

// listSnapApps Snap 应用（snap list 首列为名称、次列为版本）。
func listSnapApps() []Package {
	out, err := runPkgCmd("snap", "list")
	if err != nil {
		return nil
	}
	var pkgs []Package
	sc := bufio.NewScanner(strings.NewReader(out))
	first := true
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if first {
			first = false
			continue
		}
		if len(fields) < 2 {
			continue
		}
		pkgs = append(pkgs, Package{Name: fields[0], Version: fields[1], Source: "snap", Path: "/var/lib/snapd/snaps"})
	}
	return pkgs
}

func runPkgCmd(name string, args ...string) (string, error) {
	if _, err := exec.LookPath(name); err != nil {
		return "", err
	}
	cmd := exec.Command(name, args...)
	prochide.Hide(cmd)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
