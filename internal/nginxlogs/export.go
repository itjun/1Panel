// Package nginxlogs exports bounded, read-only snapshots through an isolated SSH session.
package nginxlogs

import (
	"bufio"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/disk"
	"golang.org/x/crypto/ssh"
)

//go:embed worker.py
var worker string

type Progress struct {
	Phase     string `json:"phase"`
	Done      uint64 `json:"done"`
	Total     uint64 `json:"total"`
	Files     int    `json:"files"`
	Skipped   int    `json:"skipped"`
	Available uint64 `json:"available"`
	Required  uint64 `json:"required"`
	Reserve   uint64 `json:"reserve"`
	SHA256    string `json:"sha256,omitempty"`
	Message   string `json:"message,omitempty"`
}

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'" }

func Command(root, temporaryDir string) (string, error) {
	for _, path := range []string{root, temporaryDir} {
		if !strings.HasPrefix(path, "/") || strings.Trim(path, "/") == "" || strings.ContainsRune(path, 0) {
			return "", fmt.Errorf("请选择日志目录和临时目录的绝对路径，不能选择根目录")
		}
	}
	// No sudo, shell interpolation, Nginx command, or service-control operation.
	return "exec nice -n 19 ionice -c 3 python3 -u -c " + quote(worker) + " " + quote(root) + " " + quote(temporaryDir), nil
}

func checkLocalSpace(dir string, required uint64) error {
	usage, err := disk.Usage(dir)
	if err != nil {
		return fmt.Errorf("无法检查本地磁盘空间: %w", err)
	}
	const reserve = uint64(512 << 20)
	if usage.Free < reserve || required > usage.Free-reserve {
		return fmt.Errorf("本地磁盘空间不足：可用 %d MiB，需 %d MiB 并预留 512 MiB", usage.Free>>20, required>>20)
	}
	return nil
}

type checkedWriter struct {
	file *os.File
	dir  string
	size uint64
}

func (w *checkedWriter) Write(p []byte) (int, error) {
	if err := checkLocalSpace(w.dir, uint64(len(p))); err != nil {
		return 0, err
	}
	n, err := w.file.Write(p)
	w.size += uint64(n)
	return n, err
}

// Export only publishes the destination after the remote process exits successfully and
// its completed archive matches both the received size and SHA-256. Existing files survive failures.
func Export(ctx context.Context, client *ssh.Client, root, temporaryDir, destination string, progress func(Progress)) error {
	command, err := Command(root, temporaryDir)
	if err != nil {
		return err
	}
	dir := filepath.Dir(destination)
	if err := checkLocalSpace(dir, 0); err != nil {
		return err
	}
	output, err := os.CreateTemp(dir, ".1panel-nginx-*.part")
	if err != nil {
		return err
	}
	defer os.Remove(output.Name())
	defer output.Close()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Hour)
	defer cancel()
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	stdin, err := session.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		return err
	}
	if err := session.Start(command); err != nil {
		return err
	}

	stop, heartbeatDone := make(chan struct{}), make(chan struct{})
	// Cancellation must also unblock a heartbeat write when the transport stops responding.
	go func() {
		select {
		case <-ctx.Done():
			_ = session.Close()
		case <-stop:
		}
	}()
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			if _, err := io.WriteString(stdin, "."); err != nil {
				return
			}
			select {
			case <-ctx.Done():
				// EOF lets the worker clean up, even on SSH servers that ignore signal requests.
				_ = stdin.Close()
				_ = session.Signal(ssh.SIGTERM)
				_ = session.Close()
				return
			case <-stop:
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() {
		close(stop)
		_ = session.Close() // also unblocks a heartbeat write after a dropped network connection
		<-heartbeatDone
	}()

	var status Progress
	var statusErr error
	var messages strings.Builder
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			var p Progress
			if err := json.Unmarshal(scanner.Bytes(), &p); err != nil {
				if messages.Len() < 8192 {
					messages.WriteString(scanner.Text() + "\n")
				}
				continue
			}
			if p.Phase == "checked" {
				if err := checkLocalSpace(dir, p.Required); err != nil {
					statusErr = err
					cancel()
				} else if _, err := io.WriteString(stdin, "A"); err != nil {
					statusErr = fmt.Errorf("确认磁盘检查失败: %w", err)
					cancel()
				}
			}
			if p.Phase == "error" && statusErr == nil {
				statusErr = fmt.Errorf("%s", p.Message)
			}
			status = p
			if progress != nil {
				progress(p)
			}
		}
		if err := scanner.Err(); err != nil && statusErr == nil {
			statusErr = fmt.Errorf("读取压缩进度失败: %w", err)
		}
	}()
	digest := sha256.New()
	writer := &checkedWriter{file: output, dir: dir}
	_, copyErr := io.CopyBuffer(io.MultiWriter(writer, digest), stdout, make([]byte, 256<<10))
	if copyErr != nil {
		cancel()
	}
	waitErr := session.Wait()
	wg.Wait()
	if statusErr != nil {
		return statusErr
	}
	if copyErr != nil {
		return fmt.Errorf("下载日志失败: %w", copyErr)
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		return fmt.Errorf("远程压缩失败（需要 Python 3、nice、ionice、stat 及日志读取权限）: %w %s", waitErr, strings.TrimSpace(messages.String()))
	}
	if status.Phase != "complete" || status.Total != writer.size || status.SHA256 != hex.EncodeToString(digest.Sum(nil)) {
		return fmt.Errorf("压缩包完整性校验失败，请重试")
	}
	if err := output.Sync(); err != nil {
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	if err := os.Rename(output.Name(), destination); err != nil {
		return fmt.Errorf("保存压缩包失败: %w", err)
	}
	return nil
}
