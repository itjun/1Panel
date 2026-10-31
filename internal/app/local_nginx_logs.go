package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"diteng-pannel/internal/nginxlogs"
)

func (s *LocalSys) NginxLogExportDefaults() map[string]string {
	return map[string]string{"temporaryDir": os.TempDir()}
}

func (s *LocalSys) ExportNginxLogs(ctx context.Context, logDir, temporaryDir, requestID string) (string, error) {
	if s.app == nil {
		return "", fmt.Errorf("应用未初始化")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	filename := "nginx-logs-" + time.Now().Format("20060102-150405") + ".tar.zst"
	dialog := s.app.Dialog.SaveFile().SetMessage("导出 Nginx 日志").SetDirectory(home).SetFilename(filename).
		SetButtonText("保存").CanCreateDirectories(true).AddFilter("Nginx 日志 (*.tar.zst)", "*.tar.zst")
	if s.mainWindow != nil {
		dialog.AttachToWindow(s.mainWindow)
	}
	destination, err := promptSaveFile(dialog, filename)
	if err != nil || destination == "" {
		return "", err
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	// 前端与远程共用进度组件，scope 防止与同名远程主机串事件。
	err = nginxlogs.ExportLocal(ctx, filepath.Clean(logDir), filepath.Clean(temporaryDir), destination, func(p nginxlogs.Progress) {
		s.app.Event.Emit("nginx-log-progress", map[string]any{"scope": "local", "host": "", "requestID": requestID, "progress": p})
	})
	if err != nil {
		return "", err
	}
	return destination, nil
}
