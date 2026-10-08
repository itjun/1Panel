//go:build darwin

package localsys

import (
	"os"
	"sync"
	"time"
)

var (
	pkgSizeMu    sync.Mutex
	pkgSizeCache []PackageSize
	pkgSizeAt    time.Time
)

// CollectPackageSizes 统计 /Applications 下各应用本体与数据目录（Containers / Application Support / Caches 等）占用（5 分钟缓存）。
func CollectPackageSizes() ([]PackageSize, error) {
	pkgSizeMu.Lock()
	defer pkgSizeMu.Unlock()
	if time.Since(pkgSizeAt) < 5*time.Minute && pkgSizeCache != nil {
		return append([]PackageSize(nil), pkgSizeCache...), nil
	}
	pkgs, err := CollectPackages()
	if err != nil {
		return nil, err
	}
	home, _ := os.UserHomeDir()
	fileSize := func(p string) uint64 {
		st, err := os.Lstat(p)
		if err != nil {
			return 0
		}
		return diskSizeOf(st)
	}
	var paths []string
	for _, p := range pkgs {
		if p.Source == "app" && p.Path != "" {
			paths = append(paths, p.Path)
		}
	}
	out := make([]PackageSize, len(paths))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, path := range paths {
		wg.Add(1)
		go func(i int, path string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			size := PackageSize{Path: path, AppSize: quickDirSize(path)}
			if meta, ok := readAppMeta(path); ok {
				for _, part := range collectAppParts(home, meta, quickDirSize, fileSize) {
					size.DataSize += part.Size
				}
			}
			out[i] = size
		}(i, path)
	}
	wg.Wait()
	pkgSizeCache = out
	pkgSizeAt = time.Now()
	return append([]PackageSize(nil), out...), nil
}
