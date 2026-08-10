package sshconfig

import (
	"bufio"
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

// RenameHost 把 ~/.ssh/config 里的 Host 别名从 oldName 改成 newName
// 行为：
//   - 只改 Host 行（其它字段不动）；Host 行可能有多个别名，只替换匹配的那一个 token
//   - 写入前自动备份
// 校验：
//   - newName 不能为空、不能含空格/制表符、不能含通配符 *
func RenameHost(oldName, newName string) error {
	if oldName == "" || newName == "" {
		return fmt.Errorf("名称不能为空")
	}
	if strings.ContainsAny(newName, " \t*") {
		return fmt.Errorf("新别名不能包含空格或通配符 *")
	}
	if oldName == newName {
		return nil
	}

	path, err := ConfigPath()
	if err != nil {
		return err
	}
	return RenameHostFile(path, oldName, newName)
}

// RenameHostFile 对指定文件执行重命名（便于测试）
func RenameHostFile(path, oldName, newName string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取 ssh config 失败: %w", err)
	}

	changed := false
	var out strings.Builder
	scanner := bufio.NewScanner(strings.NewReader(string(content)))
	for scanner.Scan() {
		raw := scanner.Text()
		line := strings.TrimSpace(raw)
		// 空行/注释直接写回
		if line == "" || strings.HasPrefix(line, "#") {
			out.WriteString(raw + "\n")
			continue
		}
		key, value, ok := splitField(line)
		if !ok || strings.ToLower(key) != "host" {
			out.WriteString(raw + "\n")
			continue
		}
		// Host 行：拆成 token，精确匹配替换 oldName
		tokens := strings.Fields(value)
		hit := false
		for i, tok := range tokens {
			if tok == oldName {
				tokens[i] = newName
				hit = true
				break
			}
		}
		if hit {
			changed = true
			// 保留原行的缩进：取 raw 里 Host 前的前缀
			indent := raw[:len(raw)-len(strings.TrimLeft(raw, " \t"))]
			out.WriteString(fmt.Sprintf("%sHost %s\n", indent, strings.Join(tokens, " ")))
		} else {
			out.WriteString(raw + "\n")
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("扫描 ssh config 失败: %w", err)
	}
	if !changed {
		return fmt.Errorf("未在 ssh config 中找到 Host 别名: %s", oldName)
	}

	// 写前备份
	if _, err := os.Stat(path); err == nil {
		if err := backup(path); err != nil {
			return fmt.Errorf("备份 ssh config 失败: %w", err)
		}
	}

	return os.WriteFile(path, []byte(out.String()), 0600)
}
