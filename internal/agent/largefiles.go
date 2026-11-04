package agent

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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
	memoryDir := scanMemoryDirectory()
	var visit func(string, int) error
	visit = func(dir string, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		switch dir {
		case "/proc", "/sys", "/dev", "/run", "/snap", "/tmp":
			return nil
		}
		// 限制同时打开的目录数量；极深目录明确标记为未完成。
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
		defer f.Close()
		for {
			if err := ctx.Err(); err != nil {
				return err
			}
			if memoryDir != "" {
				if err := checkScanMemory(memoryDir); err != nil {
					return err
				}
			}
			entries, readErr := f.ReadDir(128)
			for _, entry := range entries {
				if err := ctx.Err(); err != nil {
					return err
				}
				info, err := entry.Info()
				if err != nil {
					markIncomplete("部分文件或目录无法读取，结果可能不完整")
					continue
				}
				if info.Sys().(*syscall.Stat_t).Dev != dev {
					continue
				}
				path := filepath.Join(dir, entry.Name())
				if info.IsDir() {
					if err := visit(path, depth+1); err != nil {
						return err
					}
					continue
				}
				if !info.Mode().IsRegular() || info.Size() < 0 {
					continue
				}
				file := monitor.LargeFile{Name: entry.Name(), Dir: dir, Path: path, Size: uint64(info.Size())}
				// N 最大为 50，固定大小有序列表避免全盘排序和额外依赖。
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
			if readErr == io.EOF {
				return nil
			}
			if readErr != nil {
				markIncomplete("部分目录读取失败，结果可能不完整")
				return nil
			}
		}
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

// cgroup v2 包含遍历产生的内核记账，不能只看 Go 堆或进程 RSS。
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

func checkScanMemory(dir string) error {
	maxData, err := os.ReadFile(filepath.Join(dir, "memory.max"))
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
	currentData, err := os.ReadFile(filepath.Join(dir, "memory.current"))
	if err != nil {
		return fmt.Errorf("无法读取 Agent 内存用量: %w", err)
	}
	current, err := strconv.ParseUint(strings.TrimSpace(string(currentData)), 10, 64)
	if err != nil {
		return fmt.Errorf("Agent 内存用量无效")
	}
	// 128 MiB 上限时，在 112 MiB 主动停止，为其他采集和结果返回留余量。
	if current >= limit-limit/8 {
		return errScanMemoryPressure
	}
	return nil
}
