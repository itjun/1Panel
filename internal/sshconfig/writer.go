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

	return writeConfigAtomic(path, out.String())
}

// UpdateHostFields 更新指定 Host 别名块内的 HostName / User
// 仅改匹配到的字段；若块内原先没有 HostName 或 User 行则在 Host 行后插入
// hostName / user 传空字符串表示不修改该字段
func UpdateHostFields(name, hostName, user string) error {
	if name == "" {
		return fmt.Errorf("主机别名不能为空")
	}
	if hostName == "" && user == "" {
		return nil
	}
	path, err := ConfigPath()
	if err != nil {
		return err
	}
	return UpdateHostFieldsFile(path, name, hostName, user)
}

// UpdateHostFieldsFile 对指定文件更新 HostName / User（便于测试）
func UpdateHostFieldsFile(path, name, hostName, user string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取 ssh config 失败: %w", err)
	}

	lines := splitLines(string(content))
	var out []string
	changed := false
	inTarget := false
	sawHostName := false
	sawUser := false
	// 记录 Host 行写入 out 后的下标，便于插入缺失字段
	hostLineOutIdx := -1

	flushPendingInserts := func() {
		if !inTarget || hostLineOutIdx < 0 {
			return
		}
		var inserts []string
		if hostName != "" && !sawHostName {
			inserts = append(inserts, "    HostName "+hostName)
			changed = true
		}
		if user != "" && !sawUser {
			inserts = append(inserts, "    User "+user)
			changed = true
		}
		if len(inserts) == 0 {
			return
		}
		// 插到 Host 行之后
		at := hostLineOutIdx + 1
		next := make([]string, 0, len(out)+len(inserts))
		next = append(next, out[:at]...)
		next = append(next, inserts...)
		next = append(next, out[at:]...)
		out = next
	}

	for _, raw := range lines {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			out = append(out, raw)
			continue
		}
		key, value, ok := splitField(trimmed)
		if !ok {
			out = append(out, raw)
			continue
		}
		lk := strings.ToLower(key)

		if lk == "host" {
			// 离开上一目标块时补插入
			flushPendingInserts()
			inTarget = false
			sawHostName = false
			sawUser = false
			hostLineOutIdx = -1

			tokens := strings.Fields(value)
			for _, tok := range tokens {
				if tok == name {
					inTarget = true
					break
				}
			}
			out = append(out, raw)
			if inTarget {
				hostLineOutIdx = len(out) - 1
			}
			continue
		}

		if !inTarget {
			out = append(out, raw)
			continue
		}

		// 目标块内：改写 HostName / User
		indent := leadingWS(raw)
		switch lk {
		case "hostname":
			sawHostName = true
			if hostName != "" {
				out = append(out, indent+"HostName "+hostName)
				if value != hostName {
					changed = true
				}
			} else {
				out = append(out, raw)
			}
		case "user":
			sawUser = true
			if user != "" {
				out = append(out, indent+"User "+user)
				if value != user {
					changed = true
				}
			} else {
				out = append(out, raw)
			}
		default:
			out = append(out, raw)
		}
	}
	flushPendingInserts()

	if !changed {
		// 可能目标存在但值相同，或根本没找到
		if !hostBlockExists(lines, name) {
			return fmt.Errorf("未在 ssh config 中找到 Host 别名: %s", name)
		}
		return nil
	}
	return writeConfigAtomic(path, joinLines(out))
}

// DeleteHost 从 ~/.ssh/config 删除指定 Host 别名
// - Host 行仅有该别名：删除整个块（含紧邻上方的 ServerPanel 注释行）
// - Host 行有多个别名：只从 Host 行去掉该 token，保留其余配置
func DeleteHost(name string) error {
	if name == "" {
		return fmt.Errorf("主机别名不能为空")
	}
	path, err := ConfigPath()
	if err != nil {
		return err
	}
	return DeleteHostFile(path, name)
}

// DeleteHostFile 对指定文件删除 Host 别名（便于测试）
func DeleteHostFile(path, name string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取 ssh config 失败: %w", err)
	}

	lines := splitLines(string(content))
	var out []string
	changed := false
	skipBlock := false

	for i := 0; i < len(lines); i++ {
		raw := lines[i]
		trimmed := strings.TrimSpace(raw)

		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			if skipBlock {
				// 跳过目标块内的注释/空行，直到遇到下一个 Host
				continue
			}
			out = append(out, raw)
			continue
		}

		key, value, ok := splitField(trimmed)
		if !ok {
			if !skipBlock {
				out = append(out, raw)
			}
			continue
		}
		lk := strings.ToLower(key)

		if lk == "host" {
			skipBlock = false
			tokens := strings.Fields(value)
			idx := -1
			for ti, tok := range tokens {
				if tok == name {
					idx = ti
					break
				}
			}
			if idx < 0 {
				out = append(out, raw)
				continue
			}
			changed = true
			// 去掉目标 token
			rest := append([]string{}, tokens[:idx]...)
			rest = append(rest, tokens[idx+1:]...)
			if len(rest) == 0 {
				// 整块删除：去掉紧邻上方的 ServerPanel 注释
				for len(out) > 0 {
					prev := strings.TrimSpace(out[len(out)-1])
					if strings.HasPrefix(prev, "# === 由 ServerPanel") ||
						(prev == "" && len(out) > 1) {
						// 去掉空行或我们写入的标记注释
						if prev == "" {
							out = out[:len(out)-1]
							continue
						}
						if strings.HasPrefix(prev, "# === 由 ServerPanel") {
							out = out[:len(out)-1]
							break
						}
					}
					break
				}
				// 再去掉可能残留的前导空行（仅当 out 以空行结尾）
				for len(out) > 0 && strings.TrimSpace(out[len(out)-1]) == "" {
					out = out[:len(out)-1]
				}
				skipBlock = true
				continue
			}
			indent := leadingWS(raw)
			out = append(out, fmt.Sprintf("%sHost %s", indent, strings.Join(rest, " ")))
			// 多别名共享块：保留后续字段
			continue
		}

		if skipBlock {
			continue
		}
		out = append(out, raw)
	}

	if !changed {
		return fmt.Errorf("未在 ssh config 中找到 Host 别名: %s", name)
	}
	// 末尾保留一个换行
	return writeConfigAtomic(path, joinLines(out))
}

func hostBlockExists(lines []string, name string) bool {
	for _, raw := range lines {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, value, ok := splitField(trimmed)
		if !ok || strings.ToLower(key) != "host" {
			continue
		}
		for _, tok := range strings.Fields(value) {
			if tok == name {
				return true
			}
		}
	}
	return false
}

func leadingWS(s string) string {
	return s[:len(s)-len(strings.TrimLeft(s, " \t"))]
}

func splitLines(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	// 保留末尾空行语义：Split 后若原串以 \n 结尾会多一个空串
	parts := strings.Split(s, "\n")
	if len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	return parts
}

func joinLines(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n"
}

func writeConfigAtomic(path, content string) error {
	if _, err := os.Stat(path); err == nil {
		if err := backup(path); err != nil {
			return fmt.Errorf("备份 ssh config 失败: %w", err)
		}
	}
	return os.WriteFile(path, []byte(content), 0600)
}
