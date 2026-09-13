//go:build darwin

package localsys

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	pkgMu    sync.Mutex
	pkgCache []Package
	pkgAt    time.Time
)

// CollectPackages 列出 /Applications、Homebrew formula 与 cask（60s 缓存）。
func CollectPackages() ([]Package, error) {
	pkgMu.Lock()
	defer pkgMu.Unlock()
	if time.Since(pkgAt) < 60*time.Second && pkgCache != nil {
		out := make([]Package, len(pkgCache))
		copy(out, pkgCache)
		return out, nil
	}
	var all []Package
	all = append(all, listApplications()...)
	all = append(all, listBrew("formula")...)
	all = append(all, listBrew("cask")...)
	pkgCache = all
	pkgAt = time.Now()
	out := make([]Package, len(all))
	copy(out, all)
	return out, nil
}

func listApplications() []Package {
	entries, err := os.ReadDir("/Applications")
	if err != nil {
		return nil
	}
	type item struct {
		name string
		path string
	}
	var items []item
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".app") {
			continue
		}
		items = append(items, item{name: strings.TrimSuffix(name, ".app"), path: filepath.Join("/Applications", name)})
	}
	out := make([]Package, len(items))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, it := range items {
		wg.Add(1)
		go func(i int, it item) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			ver := appVersion(it.path)
			out[i] = Package{Name: it.name, Version: ver, Source: "app", Path: it.path}
		}(i, it)
	}
	wg.Wait()
	return out
}

func appVersion(appPath string) string {
	plist := filepath.Join(appPath, "Contents", "Info.plist")
	out, err := exec.Command("defaults", "read", plist, "CFBundleShortVersionString").Output()
	if err != nil {
		out, err = exec.Command("defaults", "read", plist, "CFBundleVersion").Output()
		if err != nil {
			return ""
		}
	}
	return strings.TrimSpace(string(out))
}

func listBrew(kind string) []Package {
	brew, err := exec.LookPath("brew")
	if err != nil {
		return nil
	}
	args := []string{"list", "--versions"}
	source := "formula"
	if kind == "cask" {
		args = []string{"list", "--cask", "--versions"}
		source = "cask"
	} else {
		args = []string{"list", "--formula", "--versions"}
	}
	out, err := exec.Command(brew, args...).Output()
	if err != nil {
		return nil
	}
	prefix := brewPrefix(brew)
	var pkgs []Package
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 1 {
			continue
		}
		name := fields[0]
		ver := ""
		if len(fields) >= 2 {
			ver = fields[1]
		}
		path := ""
		if source == "formula" && prefix != "" {
			path = filepath.Join(prefix, "Cellar", name)
		} else if source == "cask" && prefix != "" {
			path = filepath.Join(prefix, "Caskroom", name)
		}
		pkgs = append(pkgs, Package{Name: name, Version: ver, Source: source, Path: path})
	}
	return pkgs
}

func brewPrefix(brew string) string {
	out, err := exec.Command(brew, "--prefix").Output()
	if err != nil {
		return "/opt/homebrew"
	}
	return strings.TrimSpace(string(out))
}
