//go:build darwin || linux || windows

package localsys

import (
	"container/heap"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// 存储扫描通用引擎（macOS / Windows / Linux 共用）：
// 状态机、缓存、目录树、Top-N 大文件堆与扫描骨架都在这里；
// 平台差异（扫描根、容器容量、应用归并、Reveal、文件占用口径）由各平台文件提供：
//   - defaultStorageRoots() / storageContainerSummary()
//   - statKey() / diskSizeOf() / buildStorageApps()
//   - StorageReveal() / StorageOpenPrivacy()

const (
	storageLargeTopN   = 300
	storageTreeMaxKids = 200
	storageDeniedKeep  = 40
	storageCacheApp    = "ServerPanel"
	storageCacheFile   = "storage_scan.json"
	storageCacheVer    = 1
)

// ---- 扫描状态（单例） ----

type storageEngine struct {
	mu sync.RWMutex

	state        string
	errMsg       string
	startedAt    int64
	finishedAt   int64
	roots        []string
	scannedBytes uint64
	scannedFiles int64
	scannedDirs  int64
	deniedDirs   int
	deniedPaths  []string

	containerTotal uint64
	containerUsed  uint64
	containerAvail uint64

	// path -> 目录节点（仅目录）
	dirs map[string]*scanDir

	large     *fileMinHeap
	largeList []StorageFile // 扫描结束后按 size 倒序
	apps      []StorageApp

	running  atomic.Bool
	loadOnce sync.Once
}

type scanDir struct {
	path  string
	name  string
	size  uint64
	files int
	dirs  int
	// 子目录名（相对本节点）
	kids []string
}

// storageCache 落盘记录，下次启动直接加载，免重复全盘扫描。
type storageCache struct {
	Version        int               `json:"version"`
	StartedAt      int64             `json:"startedAt"`
	FinishedAt     int64             `json:"finishedAt"`
	Roots          []string          `json:"roots"`
	ScannedBytes   uint64            `json:"scannedBytes"`
	ScannedFiles   int64             `json:"scannedFiles"`
	ScannedDirs    int64             `json:"scannedDirs"`
	DeniedDirs     int               `json:"deniedDirs"`
	DeniedPaths    []string          `json:"deniedPaths"`
	ContainerTotal uint64            `json:"containerTotal"`
	ContainerUsed  uint64            `json:"containerUsed"`
	ContainerAvail uint64            `json:"containerAvail"`
	Dirs           []storageCacheDir `json:"dirs"`
	Large          []StorageFile     `json:"large"`
	Apps           []StorageApp      `json:"apps"`
}

type storageCacheDir struct {
	Path  string   `json:"path"`
	Name  string   `json:"name"`
	Size  uint64   `json:"size"`
	Files int      `json:"files"`
	Dirs  int      `json:"dirs"`
	Kids  []string `json:"kids"`
}

var storage = &storageEngine{
	state: "idle",
	dirs:  map[string]*scanDir{},
	large: &fileMinHeap{},
}

func ensureStorageLoaded() {
	storage.loadOnce.Do(func() {
		_ = storage.loadCache()
	})
}

func storageCachePath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, storageCacheApp)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, storageCacheFile), nil
}

func (e *storageEngine) loadCache() error {
	path, err := storageCachePath()
	if err != nil {
		return err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var c storageCache
	if err := json.Unmarshal(b, &c); err != nil {
		return err
	}
	if c.Version != storageCacheVer || c.FinishedAt <= 0 || len(c.Dirs) == 0 {
		return errors.New("缓存无效")
	}
	dirs := make(map[string]*scanDir, len(c.Dirs))
	for _, d := range c.Dirs {
		dirs[d.Path] = &scanDir{
			path:  d.Path,
			name:  d.Name,
			size:  d.Size,
			files: d.Files,
			dirs:  d.Dirs,
			kids:  append([]string(nil), d.Kids...),
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == "running" {
		return nil
	}
	e.state = "done"
	e.errMsg = ""
	e.startedAt = c.StartedAt
	e.finishedAt = c.FinishedAt
	e.roots = append([]string(nil), c.Roots...)
	e.scannedBytes = c.ScannedBytes
	e.scannedFiles = c.ScannedFiles
	e.scannedDirs = c.ScannedDirs
	e.deniedDirs = c.DeniedDirs
	e.deniedPaths = append([]string(nil), c.DeniedPaths...)
	e.containerTotal = c.ContainerTotal
	e.containerUsed = c.ContainerUsed
	e.containerAvail = c.ContainerAvail
	e.dirs = dirs
	e.largeList = append([]StorageFile(nil), c.Large...)
	e.apps = append([]StorageApp(nil), c.Apps...)
	return nil
}

func (e *storageEngine) saveCacheLocked() error {
	path, err := storageCachePath()
	if err != nil {
		return err
	}
	dirs := make([]storageCacheDir, 0, len(e.dirs))
	for _, d := range e.dirs {
		dirs = append(dirs, storageCacheDir{
			Path:  d.path,
			Name:  d.name,
			Size:  d.size,
			Files: d.files,
			Dirs:  d.dirs,
			Kids:  append([]string(nil), d.kids...),
		})
	}
	c := storageCache{
		Version:        storageCacheVer,
		StartedAt:      e.startedAt,
		FinishedAt:     e.finishedAt,
		Roots:          append([]string(nil), e.roots...),
		ScannedBytes:   e.scannedBytes,
		ScannedFiles:   e.scannedFiles,
		ScannedDirs:    e.scannedDirs,
		DeniedDirs:     e.deniedDirs,
		DeniedPaths:    append([]string(nil), e.deniedPaths...),
		ContainerTotal: e.containerTotal,
		ContainerUsed:  e.containerUsed,
		ContainerAvail: e.containerAvail,
		Dirs:           dirs,
		Large:          append([]StorageFile(nil), e.largeList...),
		Apps:           append([]StorageApp(nil), e.apps...),
	}
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func StorageScanStart() (*StorageStatus, error) {
	ensureStorageLoaded()
	if storage.running.Load() {
		return StorageStatusSnapshot(), nil
	}
	if !storage.running.CompareAndSwap(false, true) {
		return StorageStatusSnapshot(), nil
	}

	roots := defaultStorageRoots()
	ct, cu, ca := storageContainerSummary()

	storage.mu.Lock()
	storage.state = "running"
	storage.errMsg = ""
	storage.startedAt = time.Now().Unix()
	storage.finishedAt = 0
	storage.roots = roots
	storage.scannedBytes = 0
	storage.scannedFiles = 0
	storage.scannedDirs = 0
	storage.deniedDirs = 0
	storage.deniedPaths = nil
	storage.containerTotal = ct
	storage.containerUsed = cu
	storage.containerAvail = ca
	storage.dirs = map[string]*scanDir{}
	storage.large = &fileMinHeap{}
	heap.Init(storage.large)
	storage.largeList = nil
	storage.apps = nil
	storage.mu.Unlock()

	go storage.runScan(roots)
	return StorageStatusSnapshot(), nil
}

func StorageStatusSnapshot() *StorageStatus {
	ensureStorageLoaded()
	ct, cu, ca := storageContainerSummary()
	storage.mu.RLock()
	defer storage.mu.RUnlock()
	denied := append([]string(nil), storage.deniedPaths...)
	roots := append([]string(nil), storage.roots...)
	total, used, avail := storage.containerTotal, storage.containerUsed, storage.containerAvail
	// 容器容量始终读实时值；扫描结果（已扫描字节等）仍用内存/缓存记录
	if ct > 0 {
		total, used, avail = ct, cu, ca
	}
	return &StorageStatus{
		State:          storage.state,
		ScannedBytes:   storage.scannedBytes,
		ScannedFiles:   storage.scannedFiles,
		ScannedDirs:    storage.scannedDirs,
		DeniedDirs:     storage.deniedDirs,
		DeniedPaths:    denied,
		Error:          storage.errMsg,
		StartedAt:      storage.startedAt,
		FinishedAt:     storage.finishedAt,
		Roots:          roots,
		ContainerTotal: total,
		ContainerUsed:  used,
		ContainerAvail: avail,
	}
}

func StorageTree(path string) (*StorageNode, error) {
	ensureStorageLoaded()
	storage.mu.RLock()
	defer storage.mu.RUnlock()
	if storage.state != "done" && storage.state != "running" {
		return nil, errors.New("尚未扫描：请先开始扫描")
	}
	path = strings.TrimSpace(path)
	if path == "" || path == "/" {
		return storage.virtualRootLocked(), nil
	}
	path = filepath.Clean(path)

	d := storage.dirs[path]
	node := &StorageNode{
		Name:  filepath.Base(path),
		Path:  path,
		IsDir: true,
	}
	if d != nil {
		node.Size = d.size
		node.Files = d.files
		node.Dirs = d.dirs
	}

	var children []StorageNode
	// 已扫到的子目录
	if d != nil {
		for _, name := range d.kids {
			cp := filepath.Join(path, name)
			cd := storage.dirs[cp]
			cn := StorageNode{
				Name:  name,
				Path:  cp,
				IsDir: true,
			}
			if cd != nil {
				cn.Size = cd.size
				cn.Files = cd.files
				cn.Dirs = cd.dirs
			}
			children = append(children, cn)
		}
	}
	// 当前层文件：浅层 ReadDir（不递归）
	entries, err := os.ReadDir(path)
	if err == nil {
		seenDir := map[string]bool{}
		for _, c := range children {
			seenDir[c.Name] = true
		}
		for _, e := range entries {
			name := e.Name()
			if name == "." || name == ".." {
				continue
			}
			full := filepath.Join(path, name)
			info, err := e.Info()
			if err != nil {
				continue
			}
			mode := info.Mode()
			if mode&os.ModeSymlink != 0 {
				continue
			}
			if e.IsDir() {
				if seenDir[name] {
					continue
				}
				cn := StorageNode{Name: name, Path: full, IsDir: true}
				if cd := storage.dirs[full]; cd != nil {
					cn.Size = cd.size
					cn.Files = cd.files
					cn.Dirs = cd.dirs
				}
				children = append(children, cn)
				continue
			}
			sz := diskSizeOf(info)
			children = append(children, StorageNode{
				Name:  name,
				Path:  full,
				Size:  sz,
				IsDir: false,
			})
		}
	}

	sort.Slice(children, func(i, j int) bool {
		if children[i].Size != children[j].Size {
			return children[i].Size > children[j].Size
		}
		return children[i].Name < children[j].Name
	})
	if len(children) > storageTreeMaxKids {
		children = children[:storageTreeMaxKids]
	}
	node.Children = children
	return node, nil
}

func StorageApps() ([]StorageApp, error) {
	ensureStorageLoaded()
	storage.mu.RLock()
	defer storage.mu.RUnlock()
	if storage.state != "done" {
		return nil, errors.New("扫描未完成")
	}
	out := make([]StorageApp, len(storage.apps))
	copy(out, storage.apps)
	return out, nil
}

func StorageLargeFiles() ([]StorageFile, error) {
	ensureStorageLoaded()
	storage.mu.RLock()
	defer storage.mu.RUnlock()
	if storage.state != "done" && storage.state != "running" {
		return nil, errors.New("尚未扫描")
	}
	out := make([]StorageFile, len(storage.largeList))
	copy(out, storage.largeList)
	return out, nil
}

func (e *storageEngine) virtualRootLocked() *StorageNode {
	var children []StorageNode
	for _, r := range e.roots {
		d := e.dirs[r]
		n := StorageNode{
			Name:  displayRootName(r),
			Path:  r,
			IsDir: true,
		}
		if d != nil {
			n.Size = d.size
			n.Files = d.files
			n.Dirs = d.dirs
		}
		children = append(children, n)
	}
	sort.Slice(children, func(i, j int) bool {
		return children[i].Size > children[j].Size
	})
	var total uint64
	var files, dirs int
	for _, c := range children {
		total += c.Size
		files += c.Files
		dirs += c.Dirs
	}
	return &StorageNode{
		Name:     "扫描范围",
		Path:     "",
		Size:     total,
		Files:    files,
		Dirs:     dirs,
		IsDir:    true,
		Children: children,
	}
}

func displayRootName(r string) string {
	home, _ := os.UserHomeDir()
	if home != "" && r == home {
		return "~"
	}
	return r
}

func (e *storageEngine) runScan(roots []string) {
	defer e.running.Store(false)

	var wg sync.WaitGroup
	var progressMu sync.Mutex
	seenIno := map[inodeKey]struct{}{}
	var seenMu sync.Mutex

	type acc struct {
		bytes uint64
		files int64
		dirs  int64
	}
	var prog acc

	addDenied := func(p string) {
		e.mu.Lock()
		e.deniedDirs++
		if len(e.deniedPaths) < storageDeniedKeep {
			e.deniedPaths = append(e.deniedPaths, p)
		}
		e.mu.Unlock()
	}

	noteFile := func(path string, size uint64, mtime int64) {
		e.mu.Lock()
		defer e.mu.Unlock()
		pushLarge(e.large, StorageFile{Path: path, Size: size, ModTime: mtime}, storageLargeTopN)
	}

	bumpProgress := func(bytes uint64, files, dirs int64) {
		progressMu.Lock()
		prog.bytes += bytes
		prog.files += files
		prog.dirs += dirs
		b, f, d := prog.bytes, prog.files, prog.dirs
		progressMu.Unlock()
		e.mu.Lock()
		e.scannedBytes = b
		e.scannedFiles = f
		e.scannedDirs = d
		e.mu.Unlock()
	}

	putDir := func(d *scanDir) {
		e.mu.Lock()
		e.dirs[d.path] = d
		e.mu.Unlock()
	}

	for _, root := range roots {
		root := root
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, err := os.Lstat(root)
			if err != nil {
				addDenied(root)
				return
			}
			rootDev, _, _ := statKey(st)
			walkDir(root, filepath.Base(root), rootDev, &seenMu, seenIno, putDir, addDenied, noteFile, bumpProgress)
		}()
	}
	wg.Wait()

	// 大文件定稿
	e.mu.Lock()
	e.largeList = dumpLarge(e.large)
	e.mu.Unlock()

	// 应用归并
	apps := buildStorageApps(func(p string) uint64 {
		e.mu.RLock()
		defer e.mu.RUnlock()
		if d := e.dirs[p]; d != nil {
			return d.size
		}
		return 0
	}, func(p string) uint64 {
		// 单文件：直接 Lstat
		st, err := os.Lstat(p)
		if err != nil {
			return 0
		}
		return diskSizeOf(st)
	})

	e.mu.Lock()
	e.apps = apps
	e.state = "done"
	e.finishedAt = time.Now().Unix()
	_ = e.saveCacheLocked()
	e.mu.Unlock()
}

type inodeKey struct {
	dev uint64
	ino uint64
}

func walkDir(
	path, name string,
	rootDev uint64,
	seenMu *sync.Mutex,
	seen map[inodeKey]struct{},
	putDir func(*scanDir),
	addDenied func(string),
	noteFile func(string, uint64, int64),
	bumpProgress func(uint64, int64, int64),
) (total uint64, nFiles, nDirs int) {
	entries, err := os.ReadDir(path)
	if err != nil {
		if isPermErr(err) {
			addDenied(path)
		}
		return 0, 0, 0
	}

	node := &scanDir{path: path, name: name}
	var kidNames []string

	for _, ent := range entries {
		n := ent.Name()
		if n == "." || n == ".." {
			continue
		}
		full := filepath.Join(path, n)
		info, err := ent.Info()
		if err != nil {
			if isPermErr(err) {
				addDenied(full)
			}
			continue
		}
		mode := info.Mode()
		if mode&os.ModeSymlink != 0 {
			// 不跟随符号链接；链接本身几乎不占空间
			continue
		}
		dev, ino, nlink := statKey(info)
		if dev != rootDev {
			// 不跨卷
			continue
		}

		if ent.IsDir() {
			kidNames = append(kidNames, n)
			sz, cf, cd := walkDir(full, n, rootDev, seenMu, seen, putDir, addDenied, noteFile, bumpProgress)
			total += sz
			nFiles += cf
			nDirs += 1 + cd
			continue
		}

		// 硬链接去重
		sz := diskSizeOf(info)
		if nlink > 1 {
			key := inodeKey{dev: dev, ino: ino}
			seenMu.Lock()
			_, dup := seen[key]
			if !dup {
				seen[key] = struct{}{}
			}
			seenMu.Unlock()
			if dup {
				continue
			}
		}
		total += sz
		nFiles++
		noteFile(full, sz, info.ModTime().Unix())
		bumpProgress(sz, 1, 0)
	}

	node.size = total
	node.files = nFiles
	node.dirs = nDirs
	node.kids = kidNames
	putDir(node)
	bumpProgress(0, 0, 1)
	return total, nFiles, nDirs
}

func isPermErr(err error) bool {
	return errors.Is(err, os.ErrPermission) || errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EACCES)
}

// ---- Top-N 最小堆 ----

type fileMinHeap []StorageFile

func (h fileMinHeap) Len() int           { return len(h) }
func (h fileMinHeap) Less(i, j int) bool { return h[i].Size < h[j].Size }
func (h fileMinHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *fileMinHeap) Push(x any)        { *h = append(*h, x.(StorageFile)) }
func (h *fileMinHeap) Pop() any {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func pushLarge(h *fileMinHeap, f StorageFile, n int) {
	if f.Size == 0 {
		return
	}
	if h.Len() < n {
		heap.Push(h, f)
		return
	}
	if f.Size <= (*h)[0].Size {
		return
	}
	(*h)[0] = f
	heap.Fix(h, 0)
}

func dumpLarge(h *fileMinHeap) []StorageFile {
	out := make([]StorageFile, len(*h))
	copy(out, *h)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Size != out[j].Size {
			return out[i].Size > out[j].Size
		}
		return out[i].Path < out[j].Path
	})
	return out
}

// quickDirSize 扫描未覆盖时的轻量回退（仅一层累加，避免二次全盘）。
func quickDirSize(root string) uint64 {
	var total uint64
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		total += diskSizeOf(info)
		return nil
	})
	return total
}
