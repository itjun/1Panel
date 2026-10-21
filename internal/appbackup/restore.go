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
	"diteng-pannel/internal/portable"
)

// Files and preferences are applied before any application store opens. The
// pending archive remains until success, allowing an interrupted apply to be
// completed on the next startup; normal I/O failures roll back every write.
func Apply(s *Snapshot, root, home string) (err error) {
	return apply(s, root, home, currentOS(), atomicWrite)
}

func apply(s *Snapshot, root, home, targetOS string, write func(string, []byte, fs.FileMode) error) (err error) {
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
	rules := pathRules(s.Manifest, root, home)
	remapJSON := func(b []byte) ([]byte, error) {
		var value any
		if err := json.Unmarshal(b, &value); err != nil {
			return nil, err
		}
		var visit func(any) any
		visit = func(v any) any {
			switch x := v.(type) {
			case string:
				return rewritePathText(x, rules)
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
			text := string(b)
			if strings.Contains(text, "\r") {
				text = strings.ReplaceAll(text, "\r\n", "\n")
				text = strings.ReplaceAll(text, "\r", "\n")
			}
			text = rewritePathText(text, rules)
			if strings.HasPrefix(e.Path, "ssh/") && s.Manifest.SourceOS != targetOS {
				text = dropIncompatibleSSH(text, targetOS)
			}
			b = []byte(text)
		}
		desired[p] = b
	}
	// Validate the primary model before touching any destination.
	var primary panelstore.State
	if err := json.Unmarshal(desired[filepath.Join(root, "panel.json")], &primary); err != nil {
		return err
	}
	if s.Manifest.SourceOS != targetOS {
		for i := range primary.Hosts {
			adapted, _ := portable.AdaptHostForOS(primary.Hosts[i], targetOS)
			primary.Hosts[i] = adapted
		}
		kept := make([]panelstore.SSHOption, 0, len(primary.ExtraOptions))
		for _, opt := range primary.ExtraOptions {
			probe, _ := portable.AdaptHostForOS(panelstore.PanelHost{ExtraOptions: []panelstore.SSHOption{opt}}, targetOS)
			kept = append(kept, probe.ExtraOptions...)
		}
		primary.ExtraOptions = kept
		for i := range primary.ConfigLayout.Files {
			primary.ConfigLayout.Files[i].Content = dropIncompatibleSSH(primary.ConfigLayout.Files[i].Content, targetOS)
		}
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
			preferences[k] = rewritePathText(v, rules)
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

type pathRule struct {
	from     string
	to       string
	caseless bool
}

// pathRules 把来源机器上的绝对路径改写到当前主目录和数据目录。
// Windows 反斜杠和盘符大小写都按同一路径处理，避免只换前缀后留下 \.ssh\id。
func pathRules(m Manifest, root, home string) []pathRule {
	caseless := m.SourceOS == "windows"
	var rules []pathRule
	add := func(from, to string) {
		from = slashPath(from)
		to = slashPath(to)
		from = strings.TrimRight(from, "/")
		if len(from) < 2 {
			return
		}
		ruleCaseless := caseless || hasDriveLetter(from)
		if samePath(from, strings.TrimRight(to, "/"), ruleCaseless) {
			return
		}
		rules = append(rules, pathRule{from: from, to: to, caseless: ruleCaseless})
	}
	add(m.SourceDataDir, root)
	add(m.SourceHome, home)
	for old, dst := range m.Relocations {
		add(old, swapKnownPrefix(dst, m, home, root))
	}
	sort.Slice(rules, func(i, j int) bool { return len(rules[i].from) > len(rules[j].from) })
	return rules
}

func swapKnownPrefix(p string, m Manifest, home, root string) string {
	n := slashPath(p)
	caseless := m.SourceOS == "windows"
	data := strings.TrimRight(slashPath(m.SourceDataDir), "/")
	srcHome := strings.TrimRight(slashPath(m.SourceHome), "/")
	if suffix, ok := trimPathPrefix(n, data, caseless || hasDriveLetter(data)); ok {
		return slashPath(root) + suffix
	}
	if suffix, ok := trimPathPrefix(n, srcHome, caseless || hasDriveLetter(srcHome)); ok {
		return slashPath(home) + suffix
	}
	return n
}

func trimPathPrefix(p, prefix string, caseless bool) (string, bool) {
	if prefix == "" || len(p) < len(prefix) {
		return "", false
	}
	head := p[:len(prefix)]
	match := head == prefix
	if !match && caseless {
		match = strings.EqualFold(head, prefix)
	}
	if !match || !pathBoundary(p, len(prefix)) {
		return "", false
	}
	return p[len(prefix):], true
}

func rewritePathText(s string, rules []pathRule) string {
	if s == "" || (len(rules) == 0 && !strings.Contains(s, `\`)) {
		return s
	}
	folded := slashPath(s)
	var b strings.Builder
	i := 0
	for i < len(s) {
		if isTildePath(folded, i) {
			b.WriteByte('~')
			i++
			i = writePathRemainder(&b, folded, i, false)
			continue
		}
		matched := false
		for _, rule := range rules {
			n := len(rule.from)
			if n == 0 || i+n > len(folded) {
				continue
			}
			head := folded[i : i+n]
			ok := head == rule.from
			if !ok && rule.caseless {
				ok = strings.EqualFold(head, rule.from)
			}
			if !ok || !pathBoundary(folded, i+n) {
				continue
			}
			b.WriteString(rule.to)
			if i == 0 && !strings.ContainsAny(s, "\n\"") {
				b.WriteString(folded[i+n:])
				return b.String()
			}
			quoted := i > 0 && (s[i-1] == '"' || s[i-1] == '\'')
			i = writePathRemainder(&b, folded, i+n, quoted)
			matched = true
			break
		}
		if !matched {
			b.WriteByte(s[i])
			i++
		}
	}
	return b.String()
}

func pathBoundary(p string, index int) bool {
	if index >= len(p) {
		return true
	}
	next := p[index]
	return next == '/' || !isPathChar(next)
}

func isPathChar(c byte) bool {
	if c <= ' ' || c == '"' || c == '\'' || c == '<' || c == '>' || c == '|' || c == '*' || c == '?' {
		return false
	}
	return true
}

func isTildePath(folded string, i int) bool {
	if i >= len(folded) || folded[i] != '~' || i+1 >= len(folded) || folded[i+1] != '/' {
		return false
	}
	if i == 0 {
		return true
	}
	switch folded[i-1] {
	case ' ', '\t', '"', '\'', '=':
		return true
	default:
		return false
	}
}

func writePathRemainder(b *strings.Builder, folded string, i int, quoted bool) int {
	for i < len(folded) {
		if quoted && (folded[i] == '"' || folded[i] == '\'') {
			return i
		}
		if !quoted && !isPathChar(folded[i]) {
			return i
		}
		b.WriteByte(folded[i])
		i++
	}
	return i
}

func slashPath(p string) string { return strings.ReplaceAll(p, `\`, `/`) }

func samePath(a, b string, caseless bool) bool {
	if caseless {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func hasDriveLetter(p string) bool {
	return len(p) >= 2 && p[1] == ':' && ((p[0] >= 'a' && p[0] <= 'z') || (p[0] >= 'A' && p[0] <= 'Z'))
}

func dropIncompatibleSSH(content, targetOS string) string {
	if targetOS == "" || content == "" {
		return content
	}
	lines := strings.Split(content, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		if incompatibleSSHLine(line, targetOS) {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

func incompatibleSSHLine(line, targetOS string) bool {
	key, value, ok := sshDirective(line)
	if !ok {
		return false
	}
	if key == "usekeychain" && targetOS != "darwin" {
		return true
	}
	if targetOS == "windows" && (key == "controlmaster" || key == "controlpath" || key == "controlpersist") {
		return true
	}
	if key == "identityagent" && targetOS != "darwin" {
		agent := slashPath(value)
		if strings.Contains(agent, "/Library/") || strings.Contains(agent, "com.apple") {
			return true
		}
	}
	return false
}

func sshDirective(line string) (string, string, bool) {
	trim := strings.TrimSpace(line)
	if trim == "" || strings.HasPrefix(trim, "#") {
		return "", "", false
	}
	if i := strings.IndexByte(trim, '='); i > 0 && !strings.ContainsAny(trim[:i], " \t") {
		return strings.ToLower(strings.TrimSpace(trim[:i])), strings.Trim(strings.TrimSpace(trim[i+1:]), `"'`), true
	}
	fields := strings.Fields(trim)
	if len(fields) == 0 {
		return "", "", false
	}
	value := ""
	if len(fields) > 1 {
		value = strings.Trim(strings.Join(fields[1:], " "), `"'`)
	}
	return strings.ToLower(fields[0]), value, true
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
