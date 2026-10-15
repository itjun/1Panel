package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"diteng-pannel/internal/nginxlogs"
)

// PickAndDownloadNginxLogs selects a local destination, then checks, compresses and downloads logs.
// Wails cancellation propagates through ctx without closing the host's shared SSH connection.
func (s *Files) PickAndDownloadNginxLogs(ctx context.Context, host, logDir, temporaryDir, requestID string) (string, error) {
	if _, err := nginxlogs.Command(logDir, temporaryDir); err != nil {
		return "", err
	}
	if s.app == nil {
		return "", fmt.Errorf("应用未初始化")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	start := filepath.Join(home, "Downloads")
	if info, err := os.Stat(start); err != nil || !info.IsDir() {
		start = home
	}
	dialog := s.app.Dialog.SaveFile().SetMessage("保存 Nginx 日志压缩包").
		SetDirectory(start).SetFilename("nginx-logs-"+time.Now().Format("20060102-150405")+".tar.gz").
		SetButtonText("保存").CanCreateDirectories(true).AddFilter("Nginx 日志 (*.tar.gz)", "*.tar.gz")
	if s.mainWindow != nil {
		dialog.AttachToWindow(s.mainWindow)
	}
	destination, err := dialog.PromptForSingleSelection()
	if err != nil || destination == "" {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	opt, err := (*App)(s).connectOptionFor(host)
	if err != nil {
		return "", err
	}
	client, err := s.sshMgr.Get(host, opt)
	if err != nil {
		return "", err
	}
	err = nginxlogs.Export(ctx, client, logDir, temporaryDir, destination, func(p nginxlogs.Progress) {
		s.app.Event.Emit("nginx-log-progress", map[string]any{
			"host": host, "requestID": requestID, "progress": p,
		})
	})
	if err != nil {
		return "", err
	}
	return destination, nil
}
