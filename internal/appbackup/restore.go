package appbackup

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"diteng-pannel/internal/panelstore"
)

// Files and preferences are applied before any application store opens. The
// pending archive remains until success, allowing an interrupted apply to be
// completed on the next startup; normal I/O failures roll back every write.
func Apply(s *Snapshot, root, home string) (err error) {
	return apply(s, root, home, atomicWrite)
}

func apply(s *Snapshot, root, home string, write func(string, []byte, fs.FileMode) error) (err error) {
	if err := s.Validate(); err != nil {
		return err
	}
	// Resolve trusted base directories (e.g. macOS /var -> /private/var), while
	// still refusing symbolic links anywhere below those bases.
	if p, e := filepath.EvalSymlinks(root); e == nil {
		root = p
	}
	if p, e := filepath.EvalSymlinks(home); e == nil {
		home = p
	}
	if s.Manifest.SourceOS != currentOS() {
		return fmt.Errorf("完整应用备份来自 %s，请在相同操作系统恢复", s.Manifest.SourceOS)
	}
	replacements := map[string]string{}
	if s.Manifest.SourceHome != "" && s.Manifest.SourceHome != home {
		replacements[s.Manifest.SourceHome] = home
	}
	if s.Manifest.SourceDataDir != "" && s.Manifest.SourceDataDir != root {
		replacements[s.Manifest.SourceDataDir] = root
	}
	for old, dst := range s.Manifest.Relocations {
		if s.Manifest.SourceHome != "" {
			dst = strings.ReplaceAll(dst, s.Manifest.SourceHome, home)
		}
		replacements[old] = dst
	}
	keys := make([]string, 0, len(replacements))
	for k := range replacements {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return len(keys[i]) > len(keys[j]) })
	pairs := []string{}
	for _, k := range keys {
		pairs = append(pairs, k, replacements[k])
	}
	replace := strings.NewReplacer(pairs...)
	remapJSON := func(b []byte) ([]byte, error) {
		var value any
		if err := json.Unmarshal(b, &value); err != nil {
			return nil, err
		}
		var visit func(any) any
		visit = func(v any) any {
			switch x := v.(type) {
			case string:
				return replace.Replace(x)
			case []any:
				for i := range x {
					x[i] = visit(x[i])
				}
			case map[string]any:
				for k, v := range x {
					x[k] = visit(v)
				}
			}
			return v
		}
		return json.Marshal(visit(value))
	}
	desired := map[string][]byte{}
	for _, e := range s.Manifest.Entries {
		base, rel := root, strings.TrimPrefix(e.Path, "data/")
		if strings.HasPrefix(e.Path, "ssh/") {
			base, rel = filepath.Join(home, ".ssh"), strings.TrimPrefix(e.Path, "ssh/")
		}
		p := filepath.Join(base, filepath.FromSlash(rel))
		if err := safeTarget(p); err != nil {
			return err
		}
		b := s.Files[e.Path]
		if e.Text && strings.HasPrefix(e.Path, "data/") {
			b, err = remapJSON(b)
			if err != nil {
				return fmt.Errorf("应用文件无效 %s: %w", e.Path, err)
			}
		} else if e.Text {
			b = []byte(replace.Replace(string(b)))
		}
		desired[p] = b
	}
	// Validate the primary model before touching any destination.
	var primary panelstore.State
	if err := json.Unmarshal(desired[filepath.Join(root, "panel.json")], &primary); err != nil {
		return err
	}
	for i := range primary.ConfigLayout.Files {
		primary.ConfigLayout.Files[i].SHA256 = Hash([]byte(primary.ConfigLayout.Files[i].Content))
	}
	primaryBytes, err := json.Marshal(primary)
	if err != nil {
		return err
	}
	if err := panelstore.ValidateSnapshot(primaryBytes); err != nil {
		return err
	}
	desired[filepath.Join(root, "panel.json")] = primaryBytes
	preferences := map[string]string{}
	for k, v := range s.Manifest.Preferences {
		if json.Valid([]byte(v)) {
			b, err := remapJSON([]byte(v))
			if err != nil {
				return err
			}
			preferences[k] = string(b)
		} else {
			preferences[k] = replace.Replace(v)
		}
	}
	marker := filepath.Join(root, ".application-restore", "preferences.json")
	markerBytes, err := json.Marshal(struct {
		ID     string            `json:"id"`
		Values map[string]string `json:"values"`
	}{Hash(s.Files["data/panel.json"]), preferences})
	if err != nil {
		return err
	}
	desired[marker] = markerBytes
	paths := map[string]bool{}
	// Remove generated host files created after the snapshot, otherwise a broad
	// Include would import those newer hosts again on the next startup. Manual
	// SSH files and unrelated keys are deliberately preserved.
	sshRoot := filepath.Join(home, ".ssh")
	considerGenerated := func(p string, d fs.DirEntry, walkErr error) error {
		if os.IsNotExist(walkErr) {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		if _, ok := desired[p]; ok {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		lines := strings.Split(string(b), "\n")
		for i, line := range lines {
			if strings.TrimSpace(line) != "# 1PANNEL-GENERATED" {
				continue
			}
			paths[p] = true
			if prefix := strings.Join(lines[:i], "\n"); strings.TrimSpace(prefix) != "" {
				desired[p] = []byte(prefix + "\n")
			}
			break
		}
		return nil
	}
	if err := filepath.WalkDir(filepath.Join(sshRoot, "config.d"), considerGenerated); err != nil {
		return err
	}
	if info, err := os.Lstat(filepath.Join(sshRoot, "config")); err == nil {
		if err := considerGenerated(filepath.Join(sshRoot, "config"), fs.FileInfoToDirEntry(info), nil); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := filepath.WalkDir(root, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if p == root {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		if Excluded(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			return fmt.Errorf("应用数据包含非普通文件: %s", rel)
		}
		paths[p] = true
		return nil
	}); err != nil {
		return err
	}
	for p := range desired {
		paths[p] = true
	}
	type beforeFile struct {
		content []byte
		mode    fs.FileMode
		exists  bool
	}
	before := map[string]beforeFile{}
	ordered := make([]string, 0, len(paths))
	for p := range paths {
		ordered = append(ordered, p)
	}
	sort.Strings(ordered)
	for _, p := range ordered {
		if err := safeTarget(p); err != nil {
			return err
		}
		b, err := os.ReadFile(p)
		if os.IsNotExist(err) {
			before[p] = beforeFile{}
			continue
		}
		if err != nil {
			return err
		}
		info, err := os.Stat(p)
		if err != nil {
			return err
		}
		before[p] = beforeFile{b, info.Mode().Perm(), true}
	}
	touched := []string{}
	defer func() {
		if err == nil {
			return
		}
		for i := len(touched) - 1; i >= 0; i-- {
			p := touched[i]
			old := before[p]
			var rollback error
			if old.exists {
				rollback = atomicWrite(p, old.content, old.mode)
			} else {
				rollback = os.Remove(p)
				if os.IsNotExist(rollback) {
					rollback = nil
				}
			}
			if rollback != nil {
				err = errors.Join(err, fmt.Errorf("回滚 %s: %w", p, rollback))
			}
		}
	}()
	for _, p := range ordered {
		touched = append(touched, p)
		if b, ok := desired[p]; ok {
			err = write(p, b, 0600)
		} else {
			err = os.Remove(p)
		}
		if err != nil {
			return fmt.Errorf("恢复 %s 失败: %w", p, err)
		}
	}
	return nil
}

func safeTarget(p string) error {
	for current := p; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("恢复路径包含符号链接: %s", current)
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
	}
	return nil
}

func atomicWrite(p string, b []byte, mode fs.FileMode) (err error) {
	if err := safeTarget(p); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(p), ".restore-*.tmp")
	if err != nil {
		return err
	}
	defer func() { f.Close(); os.Remove(f.Name()) }()
	if err = f.Chmod(mode); err != nil {
		return err
	}
	if _, err = f.Write(b); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), p)
}
