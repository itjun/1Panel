package agent

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"diteng-pannel/internal/monitor"
)

func (s *Server) handleLargestFiles(w http.ResponseWriter, r *http.Request) {
	if !s.isScanning.CompareAndSwap(false, true) {
		writeErr(w, http.StatusConflict, "已有大文件扫描正在运行，请稍后重试")
		return
	}
	defer s.isScanning.Store(false)
	root := r.URL.Query().Get("root")
	if root == "" {
		root = "/"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	result, err := scanLargestFiles(ctx, root, queryInt(r.URL.Query(), "limit", 10))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// scanLargestFiles 分批读取目录，只保存 Top N。请求取消后停止遍历，无扫描子进程。
func scanLargestFiles(ctx context.Context, root string, limit int) (monitor.LargeFilesResult, error) {
	start := time.Now()
	result := monitor.LargeFilesResult{Files: []monitor.LargeFile{}}
	if !filepath.IsAbs(root) {
		return result, fmt.Errorf("扫描路径必须是绝对路径")
	}
	root = filepath.Clean(root)
	info, err := os.Lstat(root)
	if err != nil {
		return result, fmt.Errorf("无法读取扫描目录: %w", err)
	}
	if !info.IsDir() {
		return result, fmt.Errorf("扫描路径必须是目录，不能是符号链接")
	}
	dev := info.Sys().(*syscall.Stat_t).Dev
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}
	markIncomplete := func(message string) {
		result.Incomplete = true
		result.Message = message
	}
	mem := newScanMemoryGuard(scanMemoryDirectory())
	var st syscall.Stat_t
	var visit func(string, int) error
	visit = func(dir string, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		switch dir {
		case "/proc", "/sys", "/dev", "/run", "/snap", "/tmp":
			return nil
		}
		// 极深目录明确标记为未完成，避免递归栈过深。
		if depth >= 128 {
			markIncomplete("目录层级过深，部分目录未扫描")
			return nil
		}
		f, err := os.Open(dir)
		if err != nil {
			if dir == root {
				return err
			}
			markIncomplete("部分文件或目录无法读取，结果可能不完整")
			return nil
		}
		var subdirs []string
		var walkErr error
		for {
			if err := ctx.Err(); err != nil {
				walkErr = err
				break
			}
			if err := mem.check(); err != nil {
				walkErr = err
				break
			}
			entries, readErr := f.ReadDir(256)
			for _, entry := range entries {
				if err := ctx.Err(); err != nil {
					walkErr = err
					break
				}
				name := entry.Name()
				typ := entry.Type()
				// 符号链接一律跳过，避免环与跨目录重复计数。
				if typ&os.ModeSymlink != 0 {
					continue
				}
				path := filepath.Join(dir, name)
				// 目录：必须 Lstat 核对设备号，跳过挂载点。
				if typ.IsDir() {
					if err := syscall.Lstat(path, &st); err != nil {
						markIncomplete("部分文件或目录无法读取，结果可能不完整")
						continue
					}
					if st.Dev != dev {
						continue
					}
					subdirs = append(subdirs, path)
					continue
				}
				// 已知非普通文件（套接字/设备/管道等）直接跳过，避免 Info/Lstat。
				if typ != 0 && !typ.IsRegular() && typ != os.ModeIrregular {
					continue
				}
				if err := syscall.Lstat(path, &st); err != nil {
					markIncomplete("部分文件或目录无法读取，结果可能不完整")
					continue
				}
				mode := st.Mode & syscall.S_IFMT
				if mode == syscall.S_IFDIR {
					if st.Dev != dev {
						continue
					}
					subdirs = append(subdirs, path)
					continue
				}
				if mode != syscall.S_IFREG || st.Size < 0 {
					continue
				}
				// 父目录已在同一设备上；普通文件不再核对 Dev。
				size := uint64(st.Size)
				if len(result.Files) >= limit {
					smallest := result.Files[limit-1]
					if size < smallest.Size || (size == smallest.Size && path >= smallest.Path) {
						continue
					}
				}
				file := monitor.LargeFile{Name: name, Dir: dir, Path: path, Size: size}
				i := sort.Search(len(result.Files), func(i int) bool {
					return file.Size > result.Files[i].Size || (file.Size == result.Files[i].Size && file.Path < result.Files[i].Path)
				})
				if i >= limit {
					continue
				}
				result.Files = append(result.Files, monitor.LargeFile{})
				copy(result.Files[i+1:], result.Files[i:])
				result.Files[i] = file
				if len(result.Files) > limit {
					result.Files = result.Files[:limit]
				}
			}
			if walkErr != nil {
				break
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				markIncomplete("部分目录读取失败，结果可能不完整")
				break
			}
		}
		_ = f.Close()
		if walkErr != nil {
			return walkErr
		}
		for _, sub := range subdirs {
			if err := visit(sub, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	err = visit(root, 0)
	result.ElapsedMs = time.Since(start).Milliseconds()
	if err != nil {
		if err == errScanMemoryPressure {
			markIncomplete("Agent 内存接近上限，扫描已停止，结果可能不完整")
			return result, nil
		}
		if ctx.Err() == nil {
			return result, fmt.Errorf("扫描大文件失败: %w", err)
		}
		markIncomplete("扫描超时或已取消，结果可能不完整")
	}
	return result, nil
}

var errScanMemoryPressure = fmt.Errorf("Agent 内存接近上限")

// cgroup v2：遍历产生的 file/dentry 记账会抬高 memory.current，但不代表进程真的快 OOM。
func scanMemoryDirectory() string {
	data, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "0::/") {
			dir := filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(line, "0::"))
			if _, err := os.Stat(filepath.Join(dir, "memory.max")); err == nil {
				return dir
			}
		}
	}
	return ""
}

// scanMemoryHardCurrent 贴近硬顶才停扫（4MiB 与上限 1/32 取较大），给返回结果留余量。
func scanMemoryHardCurrent(limit uint64) uint64 {
	if limit == 0 {
		return 0
	}
	headroom := limit / 32
	const minHeadroom = 4 << 20
	if headroom < minHeadroom {
		headroom = minHeadroom
	}
	if headroom >= limit {
		return 0
	}
	return limit - headroom
}

// scanMemoryHardAnon 匿名内存（堆等）占到上限 3/4 视为真实压力。
func scanMemoryHardAnon(limit uint64) uint64 {
	if limit == 0 {
		return 0
	}
	return limit - limit/4
}

// scanMemorySoftCurrent 目录缓存抬高 current 时触发回收，但不因此停扫。
func scanMemorySoftCurrent(limit uint64) uint64 {
	if limit == 0 {
		return 0
	}
	return limit - limit/8
}

type scanMemoryGuard struct {
	dir         string
	nextReclaim time.Time
	reclaimFn   func()
}

func newScanMemoryGuard(dir string) *scanMemoryGuard {
	return &scanMemoryGuard{
		dir: dir,
		reclaimFn: func() {
			runtime.GC()
			time.Sleep(20 * time.Millisecond)
		},
	}
}

func (g *scanMemoryGuard) check() error {
	if g == nil || g.dir == "" {
		return nil
	}
	return g.checkWith(g.reclaimFn)
}

func (g *scanMemoryGuard) checkWith(reclaim func()) error {
	maxData, err := os.ReadFile(filepath.Join(g.dir, "memory.max"))
	if err != nil {
		return fmt.Errorf("无法读取 Agent 内存上限: %w", err)
	}
	if strings.TrimSpace(string(maxData)) == "max" {
		return nil
	}
	limit, err := strconv.ParseUint(strings.TrimSpace(string(maxData)), 10, 64)
	if err != nil || limit == 0 {
		return fmt.Errorf("Agent 内存上限无效")
	}
	current, err := readScanMemoryCurrent(g.dir)
	if err != nil {
		return err
	}
	anon, hasAnon := readScanMemoryAnon(g.dir)
	hardCurrent := scanMemoryHardCurrent(limit)
	hardAnon := scanMemoryHardAnon(limit)
	softCurrent := scanMemorySoftCurrent(limit)

	hard := current >= hardCurrent || (hasAnon && anon >= hardAnon)
	if !hard {
		// 遍历抬高的 file 记账：偶尔 GC，不中止扫描。
		if current >= softCurrent && time.Now().After(g.nextReclaim) {
			if reclaim != nil {
				reclaim()
			}
			g.nextReclaim = time.Now().Add(2 * time.Second)
		}
		return nil
	}

	if time.Now().After(g.nextReclaim) {
		if reclaim != nil {
			reclaim()
		}
		g.nextReclaim = time.Now().Add(2 * time.Second)
		current, err = readScanMemoryCurrent(g.dir)
		if err != nil {
			return err
		}
		anon, hasAnon = readScanMemoryAnon(g.dir)
		if current < hardCurrent && (!hasAnon || anon < hardAnon) {
			return nil
		}
	}
	return errScanMemoryPressure
}

func readScanMemoryCurrent(dir string) (uint64, error) {
	currentData, err := os.ReadFile(filepath.Join(dir, "memory.current"))
	if err != nil {
		return 0, fmt.Errorf("无法读取 Agent 内存用量: %w", err)
	}
	current, err := strconv.ParseUint(strings.TrimSpace(string(currentData)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("Agent 内存用量无效")
	}
	return current, nil
}

func readScanMemoryAnon(dir string) (uint64, bool) {
	data, err := os.ReadFile(filepath.Join(dir, "memory.stat"))
	if err != nil {
		return 0, false
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "anon ") {
			v, err := strconv.ParseUint(strings.TrimSpace(strings.TrimPrefix(line, "anon ")), 10, 64)
			if err != nil {
				return 0, false
			}
			return v, true
		}
	}
	return 0, false
}
