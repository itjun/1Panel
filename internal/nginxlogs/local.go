package nginxlogs

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/prochide"
	"diteng-pannel/internal/regularfile"
	"github.com/shirou/gopsutil/v4/disk"
)

var localExportLock sync.Mutex
var logFileName = regexp.MustCompile(`^(access|error)\.log(\.[0-9]+)?$`)

func findZstd(candidates []string) (string, error) {
	if bin, err := exec.LookPath("zstd"); err == nil {
		return bin, nil
	}
	// Finder / Dock 启动的应用不一定继承 Homebrew 的 PATH。
	for _, candidate := range candidates {
		if bin, err := exec.LookPath(candidate); err == nil {
			return bin, nil
		}
	}
	return "", fmt.Errorf("导出需要 zstd，请先安装后重试")
}

type localLogFile struct {
	path string
	info os.FileInfo
}

func localLogFiles(root string, now time.Time) ([]localLogFile, int, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, 0, err
	}
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	end := start.AddDate(0, 0, 1)
	var files []localLogFile
	skipped := 0
	for _, entry := range entries {
		if !logFileName.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, skipped, err
		}
		if !info.Mode().IsRegular() || info.ModTime().Before(start) || !info.ModTime().Before(end) {
			skipped++
			continue
		}
		files = append(files, localLogFile{filepath.Join(root, entry.Name()), info})
	}
	if len(files) == 0 {
		return nil, skipped, fmt.Errorf("没有当天修改的访问或错误日志")
	}
	return files, skipped, nil
}

type localCopyWriter struct {
	ctx     context.Context
	writer  io.Writer
	onWrite func(int)
}

func (w localCopyWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := w.writer.Write(p)
	if w.onWrite != nil {
		w.onWrite(n)
	}
	return n, err
}

// ExportLocal 只读原日志，使用本次文件长度生成压缩包；完成后才替换目标。
func ExportLocal(ctx context.Context, root, temporaryDir, destination string, progress func(Progress)) error {
	if !localExportLock.TryLock() {
		return fmt.Errorf("本机已有日志导出任务")
	}
	defer localExportLock.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Hour)
	defer cancel()
	for _, path := range []string{root, temporaryDir, destination} {
		if !filepath.IsAbs(path) || filepath.Clean(path) == filepath.VolumeName(path)+string(filepath.Separator) {
			return fmt.Errorf("请选择有效的绝对路径，不能选择根目录")
		}
	}
	var candidates []string
	if runtime.GOOS == "darwin" {
		candidates = []string{"/opt/homebrew/bin/zstd", "/usr/local/bin/zstd"}
	}
	bin, err := findZstd(candidates)
	if err != nil {
		return err
	}
	now := time.Now()
	files, skipped, err := localLogFiles(root, now)
	if err != nil {
		return err
	}
	destinationAbs := filepath.Clean(destination)
	if resolved, err := filepath.EvalSymlinks(destination); err == nil {
		destinationAbs = resolved
	}
	rootAbs, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	destinationDir, err := filepath.EvalSymlinks(filepath.Dir(destinationAbs))
	if err != nil {
		return err
	}
	// 当天未选中的历史轮转日志也不能被保存目标覆盖。
	if destinationDir == rootAbs && logFileName.MatchString(filepath.Base(destinationAbs)) {
		return fmt.Errorf("不能覆盖原始日志文件")
	}
	var total uint64
	for _, file := range files {
		source, err := filepath.EvalSymlinks(file.path)
		if err != nil {
			return err
		}
		if source == destinationAbs {
			return fmt.Errorf("不能覆盖原始日志文件")
		}
		total += uint64(file.info.Size())
	}
	// tar/PAX 头和不可压缩数据预算。
	required := total + total/128 + uint64(len(files))*4096 + (1 << 20)
	for _, dir := range []string{temporaryDir, filepath.Dir(destination)} {
		if err := checkLocalSpace(dir, required); err != nil {
			return err
		}
	}
	state := Progress{Phase: "checked", Total: total, Files: len(files), Skipped: skipped, Required: required, Reserve: 512 << 20, Date: now.Format("2006-01-02")}
	usage, err := disk.Usage(temporaryDir)
	if err != nil {
		return err
	}
	state.Available = usage.Free
	var lastPhase string
	var lastEmit time.Time
	emit := func() {
		if state.Phase == lastPhase && state.Done != state.Total && time.Since(lastEmit) < 100*time.Millisecond {
			return
		}
		lastPhase, lastEmit = state.Phase, time.Now()
		if progress != nil {
			progress(state)
		}
	}
	emit()
	archive, err := os.CreateTemp(temporaryDir, ".1panel-nginx-*.tar.zst")
	if err != nil {
		return err
	}
	defer os.Remove(archive.Name())
	defer archive.Close()
	cmd := exec.CommandContext(ctx, bin, "-q", "-c")
	prochide.Hide(cmd)
	cmd.WaitDelay = 2 * time.Second
	cmd.Stdout = &checkedWriter{file: archive, dir: temporaryDir}
	var errors strings.Builder
	cmd.Stderr = &errors
	input, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err = cmd.Start(); err != nil {
		return err
	}
	state.Phase = "compressing"
	emit()
	tarWriter := tar.NewWriter(input)
	var copyErr error
	for _, entry := range files {
		if err := ctx.Err(); err != nil {
			copyErr = err
			break
		}
		file, err := regularfile.Open(entry.path)
		if err != nil {
			copyErr = err
			break
		}
		info, err := file.Stat()
		if err != nil || !os.SameFile(entry.info, info) {
			file.Close()
			copyErr = fmt.Errorf("日志在导出前发生变化，请重试")
			break
		}
		header, err := tar.FileInfoHeader(entry.info, "")
		if err == nil {
			err = tarWriter.WriteHeader(header)
		}
		if err == nil {
			_, err = io.CopyN(localCopyWriter{ctx: ctx, writer: tarWriter, onWrite: func(n int) { state.Done += uint64(n); emit() }}, file, entry.info.Size())
		}
		file.Close()
		if err != nil {
			copyErr = fmt.Errorf("读取 %s 失败（文件可能被截断）：%w", entry.info.Name(), err)
			break
		}
	}
	if err := tarWriter.Close(); copyErr == nil {
		copyErr = err
	}
	input.Close()
	if copyErr != nil {
		cancel()
	}
	waitErr := cmd.Wait()
	if copyErr != nil {
		return copyErr
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		return fmt.Errorf("压缩失败：%w %s", waitErr, errors.String())
	}
	if err = archive.Sync(); err != nil {
		return err
	}
	size, err := archive.Seek(0, io.SeekEnd)
	if err != nil {
		return err
	}
	if _, err = archive.Seek(0, io.SeekStart); err != nil {
		return err
	}
	output, err := os.CreateTemp(filepath.Dir(destination), ".1panel-nginx-*.part")
	if err != nil {
		return err
	}
	defer os.Remove(output.Name())
	defer output.Close()
	state.Phase = "saving"
	state.Done = 0
	state.Total = uint64(size)
	emit()
	sourceHash := sha256.New()
	_, err = io.CopyBuffer(localCopyWriter{ctx: ctx, writer: &checkedWriter{file: output, dir: filepath.Dir(destination)}, onWrite: func(n int) { state.Done += uint64(n); emit() }}, io.TeeReader(archive, sourceHash), make([]byte, 256<<10))
	if err != nil {
		return err
	}
	if err = output.Sync(); err != nil {
		return err
	}
	if _, err = output.Seek(0, io.SeekStart); err != nil {
		return err
	}
	savedHash := sha256.New()
	if _, err = io.Copy(localCopyWriter{ctx: ctx, writer: savedHash}, output); err != nil {
		return err
	}
	if !strings.EqualFold(fmt.Sprintf("%x", sourceHash.Sum(nil)), fmt.Sprintf("%x", savedHash.Sum(nil))) {
		return fmt.Errorf("压缩包校验失败")
	}
	if err = output.Close(); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = os.Rename(output.Name(), destination); err != nil {
		return err
	}
	state.Phase = "complete"
	emit()
	return nil
}
