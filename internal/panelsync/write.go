package panelsync

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"diteng-pannel/internal/panelstore"
)

// WriteResult describes the durable side effects of a generation. The backup
// is created before any config file is replaced, so a failed multi-file write
// still leaves a recoverable point-in-time snapshot.
type WriteResult struct {
	BackupPath string       `json:"backupPath"`
	Files      []ConfigFile `json:"files"`
	Removed    []string     `json:"removed,omitempty"`
}

// Write backs up the current Panel state and the complete OpenSSH config tree,
// then replaces the generated files one by one with same-directory atomic
// renames. The function never writes panel.json; callers commit that state
// separately so they can represent a config-stale result when generation
// fails.
func Write(root, backupRoot string, state panelstore.State, generation GenerationResult) (WriteResult, error) {
	root = filepath.Clean(root)
	if root == "." || filepath.Base(root) != "config" {
		return WriteResult{}, fmt.Errorf("SSH 配置路径无效: %s", root)
	}
	if err := os.MkdirAll(filepath.Dir(root), 0700); err != nil {
		return WriteResult{}, fmt.Errorf("创建 SSH 配置目录失败: %w", err)
	}
	if err := os.Chmod(filepath.Dir(root), 0700); err != nil {
		return WriteResult{}, fmt.Errorf("设置 SSH 配置目录权限失败: %w", err)
	}
	if err := validateGenerationFiles(generation); err != nil {
		return WriteResult{}, err
	}

	current, err := ReadTree(root)
	if err != nil {
		return WriteResult{}, err
	}
	backupPath, err := CreateBackup(backupRoot, root, state, current)
	if err != nil {
		return WriteResult{}, err
	}
	if err := PruneBackups(backupRoot, 50); err != nil {
		return WriteResult{}, fmt.Errorf("清理旧配置备份失败: %w", err)
	}
	originals, err := captureOriginals(root, generation)
	if err != nil {
		return WriteResult{}, err
	}

	// Prepare every temporary file before touching a formal config file. This
	// catches permissions, disk-full and path errors up front.
	type preparedFile struct {
		target string
		tmp    string
		mode   os.FileMode
	}
	prepared := make([]preparedFile, 0, len(generation.Files))
	cleanup := func() {
		for _, item := range prepared {
			_ = os.Remove(item.tmp)
		}
	}
	defer cleanup()
	for _, file := range generation.Files {
		target, err := configTarget(root, file.Path)
		if err != nil {
			return WriteResult{}, err
		}
		if err := ensureRegularOrMissing(target); err != nil {
			return WriteResult{}, err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return WriteResult{}, fmt.Errorf("创建配置子目录失败: %w", err)
		}
		mode := os.FileMode(file.Mode & 0777)
		if mode == 0 {
			mode = 0600
		}
		tmp, err := os.CreateTemp(filepath.Dir(target), ".1pannel-config-*.tmp")
		if err != nil {
			return WriteResult{}, fmt.Errorf("创建配置临时文件失败: %w", err)
		}
		tmpName := tmp.Name()
		if err := tmp.Chmod(mode); err == nil {
			_, err = io.WriteString(tmp, file.Content)
		}
		if err == nil {
			err = tmp.Sync()
		}
		closeErr := tmp.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(tmpName)
			return WriteResult{}, fmt.Errorf("写入配置临时文件失败: %s: %w", file.Path, err)
		}
		prepared = append(prepared, preparedFile{target: target, tmp: tmpName, mode: mode})
	}

	// Commit generated files. On Unix os.Rename is atomic per file. Since a
	// generation can span config plus several config.d files, keep a rollback
	// image for the exact touched paths so a later file failure does not leave a
	// mixed old/new configuration tree behind.
	var touched []string
	rollback := func(cause error) (WriteResult, error) {
		if rollbackErr := restoreOriginals(touched, originals); rollbackErr != nil {
			return WriteResult{}, fmt.Errorf("替换 SSH 配置失败: %w；回滚也失败: %v", cause, rollbackErr)
		}
		return WriteResult{}, fmt.Errorf("替换 SSH 配置失败: %w（已回滚）", cause)
	}
	for _, item := range prepared {
		touched = append(touched, item.target)
		if err := replaceFile(item.tmp, item.target); err != nil {
			return rollback(fmt.Errorf("%s: %w", item.target, err))
		}
	}
	for _, path := range generation.RemovedFiles {
		target, err := configTarget(root, path)
		if err != nil {
			return rollback(err)
		}
		if err := ensureRegularOrMissing(target); err != nil {
			return rollback(err)
		}
		touched = append(touched, target)
		if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
			return rollback(fmt.Errorf("删除旧生成配置失败: %s: %w", path, err))
		}
	}
	return WriteResult{BackupPath: backupPath, Files: generation.Files, Removed: generation.RemovedFiles}, nil
}

type originalFile struct {
	exists  bool
	content []byte
	mode    os.FileMode
}

func captureOriginals(root string, generation GenerationResult) (map[string]originalFile, error) {
	paths := append([]string{}, generation.RemovedFiles...)
	for _, file := range generation.Files {
		paths = append(paths, file.Path)
	}
	originals := make(map[string]originalFile, len(paths))
	for _, relative := range paths {
		target, err := configTarget(root, relative)
		if err != nil {
			return nil, err
		}
		if _, ok := originals[target]; ok {
			continue
		}
		if err := ensureRegularOrMissing(target); err != nil {
			return nil, err
		}
		info, err := os.Stat(target)
		if os.IsNotExist(err) {
			originals[target] = originalFile{}
			continue
		}
		if err != nil {
			return nil, err
		}
		content, err := os.ReadFile(target)
		if err != nil {
			return nil, err
		}
		originals[target] = originalFile{exists: true, content: content, mode: info.Mode().Perm()}
	}
	return originals, nil
}

func restoreOriginals(touched []string, originals map[string]originalFile) error {
	seen := make(map[string]struct{}, len(touched))
	for i := len(touched) - 1; i >= 0; i-- {
		target := touched[i]
		if _, ok := seen[target]; ok {
			continue
		}
		seen[target] = struct{}{}
		original, ok := originals[target]
		if !ok {
			continue
		}
		if !original.exists {
			if err := ensureRegularOrMissing(target); err != nil {
				return err
			}
			if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}
		if err := writePrivateFile(target, original.content, original.mode); err != nil {
			return err
		}
	}
	return nil
}

// CreateBackup stores the raw config tree and the JSON state in a private,
// timestamped directory. Private keys are intentionally never traversed or
// copied because only the OpenSSH config files are passed in.
func CreateBackup(backupRoot, root string, state panelstore.State, files []ConfigFile) (string, error) {
	if strings.TrimSpace(backupRoot) == "" {
		backupRoot = filepath.Join(filepath.Dir(root), ".1pannel-backups")
	}
	if err := os.MkdirAll(backupRoot, 0700); err != nil {
		return "", fmt.Errorf("创建配置备份目录失败: %w", err)
	}
	backupPath, err := os.MkdirTemp(backupRoot, time.Now().Format("20060102-150405")+"-")
	if err != nil {
		return "", fmt.Errorf("创建配置备份快照失败: %w", err)
	}
	if err := os.Chmod(backupPath, 0700); err != nil {
		return "", err
	}

	stateBytes, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return "", fmt.Errorf("序列化备份 JSON 失败: %w", err)
	}
	if err := writePrivateFile(filepath.Join(backupPath, "panel.json"), stateBytes, 0600); err != nil {
		return "", err
	}
	manifest := struct {
		Version   int          `json:"version"`
		CreatedAt int64        `json:"createdAt"`
		Files     []ConfigFile `json:"files"`
	}{Version: 1, CreatedAt: time.Now().Unix(), Files: files}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	if err := writePrivateFile(filepath.Join(backupPath, "manifest.json"), manifestBytes, 0600); err != nil {
		return "", err
	}
	for _, file := range files {
		target, err := configTarget(filepath.Join(backupPath, "config"), file.Path)
		if err != nil {
			return "", err
		}
		if err := writePrivateFile(target, []byte(file.Content), os.FileMode(file.Mode&0777)); err != nil {
			return "", err
		}
	}
	return backupPath, nil
}

// PruneBackups keeps the newest private automatic snapshots. A backup is
// considered valid only when it is a directory containing panel.json and
// manifest.json; unrelated user files in the backup root are left untouched.
func PruneBackups(backupRoot string, keep int) error {
	if keep < 1 {
		keep = 1
	}
	entries, err := os.ReadDir(backupRoot)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	type backupEntry struct {
		path string
		when time.Time
	}
	backups := make([]backupEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(backupRoot, entry.Name())
		if _, err := os.Stat(filepath.Join(path, "panel.json")); err != nil {
			continue
		}
		if _, err := os.Stat(filepath.Join(path, "manifest.json")); err != nil {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		backups = append(backups, backupEntry{path: path, when: info.ModTime()})
	}
	sort.SliceStable(backups, func(i, j int) bool {
		if backups[i].when.Equal(backups[j].when) {
			return backups[i].path > backups[j].path
		}
		return backups[i].when.After(backups[j].when)
	})
	if len(backups) <= keep {
		return nil
	}
	for _, backup := range backups[keep:] {
		if err := os.RemoveAll(backup.path); err != nil {
			return err
		}
	}
	return nil
}

func validateGenerationFiles(generation GenerationResult) error {
	seen := make(map[string]struct{}, len(generation.Files))
	for _, file := range generation.Files {
		path := cleanRelative(file.Path)
		if path == "." || path == "" || strings.HasPrefix(path, "../") || filepath.IsAbs(file.Path) {
			return fmt.Errorf("生成配置路径越界: %s", file.Path)
		}
		if _, ok := seen[path]; ok {
			return fmt.Errorf("生成配置路径重复: %s", file.Path)
		}
		seen[path] = struct{}{}
	}
	for _, path := range generation.RemovedFiles {
		clean := cleanRelative(path)
		if clean == "." || clean == "" || strings.HasPrefix(clean, "../") || filepath.IsAbs(path) {
			return fmt.Errorf("待删除配置路径越界: %s", path)
		}
	}
	return nil
}

func configTarget(root, relative string) (string, error) {
	relative = cleanRelative(relative)
	if relative == "." || relative == "" || strings.HasPrefix(relative, "../") || filepath.IsAbs(relative) {
		return "", fmt.Errorf("配置路径越界: %s", relative)
	}
	target := filepath.Join(filepath.Dir(root), filepath.FromSlash(relative))
	resolved, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	base, err := filepath.Abs(filepath.Dir(root))
	if err != nil {
		return "", err
	}
	if resolved != base && !strings.HasPrefix(resolved, base+string(filepath.Separator)) {
		return "", fmt.Errorf("配置路径不在 SSH 目录内: %s", relative)
	}
	return resolved, nil
}

func ensureRegularOrMissing(path string) error {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("拒绝写入符号链接配置: %s", path)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("配置目标不是普通文件: %s", path)
	}
	return nil
}

func replaceFile(tmp, target string) error {
	if err := os.Rename(tmp, target); err == nil {
		return nil
	}
	// Windows cannot replace an existing file with Rename. The target was
	// validated above and the full config tree has already been backed up.
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tmp, target)
}

func writePrivateFile(path string, content []byte, mode os.FileMode) error {
	if mode == 0 {
		mode = 0600
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".1pannel-backup-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	clean := true
	defer func() {
		if clean {
			_ = os.Remove(tmpName)
		}
	}()
	if err := tmp.Chmod(mode); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := replaceFile(tmpName, path); err != nil {
		return err
	}
	clean = false
	return nil
}
