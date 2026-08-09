package sshconfig

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// AppendHost 把一个新的 Host 条目追加到 ~/.ssh/config 的末尾
// 写入前自动备份原文件为 ~/.ssh/config.bak.YYYYMMDD-HHMMSS
// 写入格式严格遵循 ssh_config 标准语法
func AppendHost(cfg HostConfig) error {
	path, err := ConfigPath()
	if err != nil {
		return err
	}

	// 确保 ~/.ssh 存在
	sshDir := filepath.Dir(path)
	if err := os.MkdirAll(sshDir, 0700); err != nil {
		return fmt.Errorf("创建 %s 失败: %w", sshDir, err)
	}

	// 写前备份
	if _, err := os.Stat(path); err == nil {
		if err := backup(path); err != nil {
			return fmt.Errorf("备份 ssh config 失败: %w", err)
		}
	}

	// 追加模式写入
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("打开 ssh config 失败: %w", err)
	}
	defer f.Close()

	block := renderHostBlock(cfg)
	if _, err := io.WriteString(f, block); err != nil {
		return fmt.Errorf("写入 ssh config 失败: %w", err)
	}
	return nil
}

func renderHostBlock(cfg HostConfig) string {
	var b strings.Builder
	b.WriteString("\n# === 由 ServerPanel 添加 于 ")
	b.WriteString(time.Now().Format("2006-01-02 15:04:05"))
	b.WriteString(" ===\n")
	b.WriteString("Host ")
	b.WriteString(cfg.Name)
	b.WriteString("\n")
	if cfg.HostName != "" {
		b.WriteString("    HostName ")
		b.WriteString(cfg.HostName)
		b.WriteString("\n")
	}
	if cfg.User != "" {
		b.WriteString("    User ")
		b.WriteString(cfg.User)
		b.WriteString("\n")
	}
	if cfg.Port != "" && cfg.Port != "22" {
		b.WriteString("    Port ")
		b.WriteString(cfg.Port)
		b.WriteString("\n")
	}
	if cfg.IdentityFile != "" {
		b.WriteString("    IdentityFile ")
		b.WriteString(cfg.IdentityFile)
		b.WriteString("\n")
	}
	if cfg.ProxyJump != "" {
		b.WriteString("    ProxyJump ")
		b.WriteString(cfg.ProxyJump)
		b.WriteString("\n")
	}
	return b.String()
}

func backup(path string) error {
	ts := time.Now().Format("20060102-150405")
	dst := fmt.Sprintf("%s.bak.%s", path, ts)
	src, err := os.Open(path)
	if err != nil {
		return err
	}
	defer src.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, src)
	return err
}
