// Package panelsync bridges the Panel JSON model and the user's OpenSSH
// configuration tree. The JSON model remains authoritative; config files are
// imported on drift and generated on Panel saves.
package panelsync

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	"diteng-pannel/internal/groupid"
	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/prochide"
)

const generatedMarker = "# 1PANNEL-GENERATED"

type ConfigFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Mode    uint32 `json:"mode,omitempty"`
	SHA256  string `json:"sha256,omitempty"`
}

type ConfigDiff struct {
	ChangedFiles []string          `json:"changedFiles,omitempty"`
	AddedHosts   []string          `json:"addedHosts,omitempty"`
	RemovedHosts []string          `json:"removedHosts,omitempty"`
	ChangedHosts []string          `json:"changedHosts,omitempty"`
	Conflicts    []string          `json:"conflicts,omitempty"`
	Imported     *panelstore.State `json:"-"`
}

func (d ConfigDiff) HasChanges() bool {
	return len(d.ChangedFiles) > 0 || len(d.AddedHosts) > 0 || len(d.RemovedHosts) > 0 || len(d.ChangedHosts) > 0 || len(d.Conflicts) > 0
}

type ImportResult struct {
	State       panelstore.State `json:"state"`
	Diff        ConfigDiff       `json:"diff"`
	NeedsReview bool             `json:"needsReview"`
}

type GenerationResult struct {
	Files        []ConfigFile `json:"files"`
	RemovedFiles []string     `json:"removedFiles,omitempty"`
	GeneratedAt  int64        `json:"generatedAt"`
}

// Compare reads the current config tree and compares it with the snapshot in
// state. It also builds an import candidate so callers can show a useful diff
// instead of reparsing the files a second time.
func Compare(ctx context.Context, root string, state panelstore.State) (ConfigDiff, error) {
	if err := ctx.Err(); err != nil {
		return ConfigDiff{}, err
	}
	files, err := ReadTree(root)
	if err != nil {
		return ConfigDiff{}, err
	}
	// A failed or interrupted group rename can leave a generated file on disk
	// under the old name while the Panel snapshot already records the new
	// name. If the bytes are exactly the snapshot bytes, this is an internal
	// path relocation rather than an external edit. Canonicalize that case
	// before importing so the normal generator can finish the rename. Any
	// content change, ambiguous match, or untracked path remains a drift.
	files = normalizeGeneratedPathRelocations(files, state)
	current := make(map[string]ConfigFile, len(files))
	for _, f := range files {
		current[f.Path] = f
	}
	previous := make(map[string]panelstore.ConfigFile, len(state.ConfigLayout.Files))
	for _, f := range state.ConfigLayout.Files {
		previous[f.Path] = f
	}
	var changed []string
	for path, f := range current {
		old, ok := previous[path]
		if !ok || old.SHA256 != f.SHA256 {
			changed = append(changed, path)
		}
	}
	for path := range previous {
		if _, ok := current[path]; !ok {
			changed = append(changed, path)
		}
	}
	sort.Strings(changed)

	candidate, conflicts, err := importTree(root, files, state)
	if err != nil {
		return ConfigDiff{}, err
	}
	if len(files) > 0 {
		if syntaxErr := validateConfigSyntax(ctx, root); syntaxErr != nil {
			conflicts = append(conflicts, syntaxErr.Error())
		}
	}
	diff := ConfigDiff{ChangedFiles: changed, Conflicts: conflicts, Imported: &candidate}
	oldHosts := hostMap(state.Hosts)
	newHosts := hostMap(candidate.Hosts)
	for alias := range newHosts {
		if _, ok := oldHosts[alias]; !ok {
			diff.AddedHosts = append(diff.AddedHosts, alias)
		} else if !sameHost(oldHosts[alias], newHosts[alias]) {
			diff.ChangedHosts = append(diff.ChangedHosts, alias)
		}
	}
	for alias := range oldHosts {
		if _, ok := newHosts[alias]; !ok {
			diff.RemovedHosts = append(diff.RemovedHosts, alias)
			old := oldHosts[alias]
			if old.Password != "" || old.Note != "" || old.GroupID != "" {
				diff.Conflicts = append(diff.Conflicts, fmt.Sprintf("Host %s 从 SSH 配置消失，可能丢失 Panel 密码或分组/备注", alias))
			}
		}
	}
	for _, path := range changed {
		if file, ok := current[path]; ok && hasDirective(file.Content, "match") {
			diff.Conflicts = append(diff.Conflicts, fmt.Sprintf("文件 %s 包含已变更的 Match 条件块，需要人工确认", path))
		}
	}
	diff.Conflicts = unique(diff.Conflicts)
	sort.Strings(diff.AddedHosts)
	sort.Strings(diff.ChangedHosts)
	sort.Strings(diff.RemovedHosts)
	return diff, nil
}

func normalizeGeneratedPathRelocations(files []ConfigFile, state panelstore.State) []ConfigFile {
	previous := make(map[string]panelstore.ConfigFile, len(state.ConfigLayout.Files))
	for _, file := range state.ConfigLayout.Files {
		previous[cleanRelative(file.Path)] = file
	}
	generated := make(map[string]struct{}, len(state.ConfigLayout.GeneratedFiles))
	for _, path := range state.ConfigLayout.GeneratedFiles {
		generated[cleanRelative(path)] = struct{}{}
	}
	expected := make(map[string]struct{}, len(state.Groups)+1)
	expected["config"] = struct{}{}
	for _, group := range state.Groups {
		expected[cleanRelative(filepath.Join("config.d", safeFileName(group.ID)+".conf"))] = struct{}{}
	}

	current := make(map[string]ConfigFile, len(files))
	for _, file := range files {
		current[cleanRelative(file.Path)] = file
	}
	missing := make([]panelstore.ConfigFile, 0)
	for path, file := range previous {
		if _, ok := expected[path]; !ok {
			continue
		}
		if _, ok := current[path]; !ok {
			missing = append(missing, file)
		}
	}
	if len(missing) == 0 {
		return files
	}

	used := make(map[string]struct{}, len(missing))
	relocated := make(map[string]string, len(missing))
	for _, wanted := range missing {
		var match string
		matches := 0
		for path, file := range current {
			if _, ok := generated[path]; !ok {
				continue
			}
			if _, ok := previous[path]; ok {
				continue
			}
			if _, ok := used[path]; ok || file.SHA256 != wanted.SHA256 || file.Content != wanted.Content {
				continue
			}
			match = path
			matches++
		}
		if matches == 1 {
			relocated[match] = cleanRelative(wanted.Path)
			used[match] = struct{}{}
		}
	}
	if len(relocated) == 0 {
		return files
	}

	out := make([]ConfigFile, len(files))
	for i, file := range files {
		path := cleanRelative(file.Path)
		if target, ok := relocated[path]; ok {
			file.Path = target
		}
		out[i] = file
	}
	sort.Slice(out, func(i, j int) bool { return cleanRelative(out[i].Path) < cleanRelative(out[j].Path) })
	return out
}

func validateConfigSyntax(ctx context.Context, root string) error {
	cmd := exec.CommandContext(ctx, "ssh", "-G", "-F", root, "__1pannel_config_probe__")
	prochide.Hide(cmd)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	message := strings.TrimSpace(string(output))
	if message == "" {
		message = err.Error()
	}
	return fmt.Errorf("SSH 配置语法或 Include 无效: %s", message)
}

// Import applies a validated config snapshot to the Panel model. Password and
// UI metadata are kept by alias; config files never contain passwords.
func Import(ctx context.Context, root string, state panelstore.State) (ImportResult, error) {
	diff, err := Compare(ctx, root, state)
	if err != nil {
		return ImportResult{}, err
	}
	if len(diff.Conflicts) > 0 {
		return ImportResult{State: state, Diff: diff, NeedsReview: true}, nil
	}
	if diff.Imported == nil {
		return ImportResult{State: state, Diff: diff}, nil
	}
	return ImportResult{State: *diff.Imported, Diff: diff}, nil
}

func Generate(state panelstore.State) (GenerationResult, error) {
	if err := validateState(state); err != nil {
		return GenerationResult{}, err
	}
	base := make(map[string]string)
	for _, file := range state.ConfigLayout.Files {
		base[cleanRelative(file.Path)] = file.Content
	}
	mainPath := "config"
	main := renderFile(base[mainPath], hostsForGroup(state.Hosts, ""), state, true)
	files := []ConfigFile{{Path: mainPath, Content: main, Mode: 0600, SHA256: panelstore.SHA256([]byte(main))}}

	groupIDs := make([]string, 0, len(state.Groups))
	for _, g := range state.Groups {
		groupIDs = append(groupIDs, g.ID)
	}
	sort.Strings(groupIDs)
	generated := []string{"config"}
	for _, id := range groupIDs {
		path := filepath.ToSlash(filepath.Join("config.d", safeFileName(id)+".conf"))
		content := renderFile(base[path], hostsForGroup(state.Hosts, id), state, false)
		files = append(files, ConfigFile{Path: path, Content: content, Mode: 0600, SHA256: panelstore.SHA256([]byte(content))})
		generated = append(generated, path)
	}

	oldGenerated := make(map[string]struct{}, len(state.ConfigLayout.GeneratedFiles))
	for _, path := range state.ConfigLayout.GeneratedFiles {
		oldGenerated[cleanRelative(path)] = struct{}{}
	}
	var removed []string
	for path := range oldGenerated {
		found := false
		for _, f := range files {
			if cleanRelative(f.Path) == path {
				found = true
				break
			}
		}
		if !found {
			removed = append(removed, path)
		}
	}
	sort.Strings(removed)
	return GenerationResult{Files: files, RemovedFiles: removed, GeneratedAt: time.Now().Unix()}, nil
}

func ReadTree(root string) ([]ConfigFile, error) {
	root = filepath.Clean(root)
	sshDir := filepath.Dir(root)
	visited := map[string]bool{}
	var out []ConfigFile
	var visit func(string) error
	visit = func(path string) error {
		path = filepath.Clean(path)
		if visited[path] {
			return nil
		}
		visited[path] = true
		b, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) && path == root {
				return nil
			}
			return fmt.Errorf("读取 ssh config 文件失败: %s: %w", path, err)
		}
		st, err := os.Stat(path)
		if err != nil {
			return err
		}
		if st.IsDir() {
			// Include ~/.ssh/config.d/* may also match a directory. OpenSSH
			// ignores it as a config file; do the same instead of turning a
			// harmless directory into a watcher/import error.
			return nil
		}
		rel := relativeConfigPath(sshDir, path)
		out = append(out, ConfigFile{Path: rel, Content: string(b), Mode: uint32(st.Mode().Perm()), SHA256: panelstore.SHA256(b)})
		for _, include := range includes(string(b)) {
			matches, err := expandInclude(filepath.Dir(path), include)
			if err != nil {
				return err
			}
			for _, match := range matches {
				if err := visit(match); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := visit(root); err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func importTree(root string, files []ConfigFile, previous panelstore.State) (panelstore.State, []string, error) {
	next := previous
	next.Hosts = nil
	next.ConfigLayout.Files = make([]panelstore.ConfigFile, 0, len(files))
	groupSeen := make(map[string]bool, len(next.Groups))
	for _, group := range next.Groups {
		groupSeen[group.ID] = true
	}
	for _, f := range files {
		next.ConfigLayout.Files = append(next.ConfigLayout.Files, panelstore.ConfigFile{Path: f.Path, Content: f.Content, Mode: f.Mode, SHA256: f.SHA256})
		if groupID := groupIDForPath(f.Path); groupID != "" && !groupSeen[groupID] {
			next.Groups = append(next.Groups, panelstore.PanelGroup{ID: groupID, Name: groupID, Order: len(next.Groups)})
			groupSeen[groupID] = true
		}
	}
	old := hostMap(previous.Hosts)
	var conflicts []string
	seen := map[string]string{}
	groupOrder := map[string]int{}
	for _, file := range files {
		parsed := parseHosts(file.Content)
		groupID := groupIDForPath(file.Path)
		for _, h := range parsed {
			if prior, ok := seen[h.Alias]; ok {
				conflicts = append(conflicts, fmt.Sprintf("Host %s 同时存在于 %s 和 %s", h.Alias, prior, file.Path))
				continue
			}
			seen[h.Alias] = file.Path
			h.GroupID = groupID
			h.Order = groupOrder[groupID]
			groupOrder[groupID]++
			if oldHost, ok := old[h.Alias]; ok {
				// Group membership, order, password and notes are Panel/UI
				// metadata. A normal config edit (especially a legacy single
				// ~/.ssh/config) must not erase them because the parsed file has
				// no config.d group path. Explicit config.d ownership still wins
				// when an external tool moved a host there.
				if h.GroupID == "" || h.GroupID == oldHost.GroupID {
					h.GroupID = oldHost.GroupID
					h.Order = oldHost.Order
				}
				h.Password = oldHost.Password
				h.Note = oldHost.Note
			}
			next.Hosts = append(next.Hosts, h)
		}
	}
	return next, unique(conflicts), nil
}

func parseHosts(content string) []panelstore.PanelHost {
	lines := splitLines(content)
	var out []panelstore.PanelHost
	var current []int
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := splitField(line)
		if !ok {
			continue
		}
		switch strings.ToLower(key) {
		case "host":
			current = nil
			for _, alias := range strings.Fields(value) {
				if strings.ContainsAny(alias, "*?!") {
					continue
				}
				out = append(out, panelstore.PanelHost{Alias: alias, Port: "22", IdentityFiles: []string{}, ExtraOptions: []panelstore.SSHOption{}})
				current = append(current, len(out)-1)
			}
		case "match":
			// Match has conditional semantics that cannot be represented by a
			// single PanelHost. Keep the original text in ConfigLayout, but do
			// not accidentally attach the following options to the preceding
			// explicit Host block.
			current = nil
		case "include":
			// Include files are visited independently by ReadTree. Keeping the
			// directive out of ExtraOptions avoids importing the same line as a
			// host option while preserving it verbatim in the raw layout.
		default:
			for _, index := range current {
				applyField(&out[index], key, value)
			}
		}
	}
	return out
}

func hasDirective(content, wanted string) bool {
	for _, raw := range splitLines(content) {
		key, _, ok := splitField(strings.TrimSpace(raw))
		if ok && strings.EqualFold(key, wanted) {
			return true
		}
	}
	return false
}

func applyField(h *panelstore.PanelHost, key, value string) {
	switch strings.ToLower(key) {
	case "hostname":
		h.HostName = value
	case "user":
		h.User = value
	case "port":
		h.Port = value
	case "identityfile":
		h.IdentityFiles = append(h.IdentityFiles, value)
	case "proxyjump":
		h.ProxyJump = value
	case "proxycommand":
		h.ProxyCommand = value
	case "identityagent":
		h.IdentityAgent = value
	case "forwardagent":
		h.ForwardAgent = strings.EqualFold(value, "yes") || strings.EqualFold(value, "true")
	case "hostkeyalgorithms":
		h.HostKeyAlgos = value
	case "localforward", "remoteforward", "dynamicforward":
		if forward, ok := parsePortForward(key, value); ok {
			h.PortForwards = append(h.PortForwards, forward)
			return
		}
		h.ExtraOptions = append(h.ExtraOptions, panelstore.SSHOption{Key: key, Value: value})
	default:
		h.ExtraOptions = append(h.ExtraOptions, panelstore.SSHOption{Key: key, Value: value})
	}
}

func parsePortForward(key, value string) (panelstore.PortForward, bool) {
	fields := strings.Fields(value)
	kind := strings.ToLower(key)
	if kind == "dynamicforward" {
		if len(fields) != 1 {
			return panelstore.PortForward{}, false
		}
		bind, port, ok := parseForwardEndpoint(fields[0], false)
		if !ok || port == "" {
			return panelstore.PortForward{}, false
		}
		return panelstore.PortForward{Kind: kind, Bind: bind, Port: port}, true
	}
	if len(fields) != 2 {
		return panelstore.PortForward{}, false
	}
	bind, port, ok := parseForwardEndpoint(fields[0], false)
	if !ok || port == "" {
		return panelstore.PortForward{}, false
	}
	target, targetPort, ok := parseForwardEndpoint(fields[1], true)
	if !ok || target == "" || targetPort == "" {
		return panelstore.PortForward{}, false
	}
	return panelstore.PortForward{Kind: kind, Bind: bind, Port: port, Target: target, TargetPort: targetPort}, true
}

func parseForwardEndpoint(spec string, requireHost bool) (string, string, bool) {
	spec = strings.Trim(spec, "\"'")
	if spec == "" {
		return "", "", false
	}
	if strings.HasPrefix(spec, "[") {
		end := strings.IndexByte(spec, ']')
		if end < 0 || end+1 >= len(spec) || spec[end+1] != ':' {
			return "", "", false
		}
		host, port := spec[1:end], spec[end+2:]
		if host == "" || port == "" {
			return "", "", false
		}
		return host, port, true
	}
	if index := strings.LastIndexByte(spec, ':'); index > 0 && index+1 < len(spec) {
		return spec[:index], spec[index+1:], true
	}
	if requireHost {
		return "", "", false
	}
	return "", spec, true
}

func renderFile(raw string, hosts []panelstore.PanelHost, state panelstore.State, main bool) string {
	managed := hostMap(state.Hosts)
	for _, alias := range state.ConfigLayout.ManagedHosts {
		if _, ok := managed[alias]; !ok {
			managed[alias] = panelstore.PanelHost{Alias: alias}
		}
	}
	lines := splitLines(raw)
	var out []string
	for i := 0; i < len(lines); {
		line := lines[i]
		if strings.TrimSpace(line) == generatedMarker {
			// Everything after the marker belongs to the previous Panel
			// generation. Dropping the complete managed tail also cleans up
			// aliases removed or renamed in JSON, even when the old alias is no
			// longer present in the current host list.
			break
		}
		key, value, ok := splitField(strings.TrimSpace(line))
		if !ok || !strings.EqualFold(key, "host") {
			out = append(out, line)
			i++
			continue
		}
		tokens := strings.Fields(value)
		remove := false
		for _, token := range tokens {
			if _, ok := managed[token]; ok && !strings.ContainsAny(token, "*?!") {
				remove = true
				break
			}
		}
		j := i + 1
		for j < len(lines) {
			k, _, ok := splitField(strings.TrimSpace(lines[j]))
			if ok && strings.EqualFold(k, "host") {
				break
			}
			j++
		}
		if !remove {
			out = append(out, lines[i:j]...)
		}
		i = j
	}
	if main && !hasGeneratedInclude(out) {
		out = appendGeneratedSection(out, "# 1PANNEL include", "Include ~/.ssh/config.d/*")
	}
	if len(hosts) > 0 {
		out = appendGeneratedSection(out, generatedMarker)
		for i, h := range hosts {
			if i > 0 {
				out = append(out, "")
			}
			out = append(out, renderHost(h)...)
		}
	}
	return joinLines(out)
}

// appendGeneratedSection removes stale separator lines before appending a
// generated section. Blank lines have no OpenSSH semantics, so generated files
// start at the first meaningful line and do not accumulate visual padding on
// repeated generations.
func appendGeneratedSection(lines []string, section ...string) []string {
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return append(lines, section...)
}

func renderHost(h panelstore.PanelHost) []string {
	lines := []string{"Host " + h.Alias}
	if h.HostName != "" {
		lines = append(lines, "    HostName "+h.HostName)
	}
	if h.User != "" {
		lines = append(lines, "    User "+h.User)
	}
	if h.Port != "" && h.Port != "22" {
		lines = append(lines, "    Port "+h.Port)
	}
	for _, file := range h.IdentityFiles {
		if strings.TrimSpace(file) != "" {
			lines = append(lines, "    IdentityFile "+file)
		}
	}
	if h.ProxyJump != "" {
		lines = append(lines, "    ProxyJump "+h.ProxyJump)
	}
	if h.ProxyCommand != "" {
		lines = append(lines, "    ProxyCommand "+h.ProxyCommand)
	}
	if h.IdentityAgent != "" {
		lines = append(lines, "    IdentityAgent "+h.IdentityAgent)
	}
	if h.ForwardAgent {
		lines = append(lines, "    ForwardAgent yes")
	}
	if h.HostKeyAlgos != "" {
		lines = append(lines, "    HostKeyAlgorithms "+h.HostKeyAlgos)
	}
	for _, forward := range h.PortForwards {
		if line, ok := renderPortForward(forward); ok {
			lines = append(lines, "    "+line)
		}
	}
	for _, option := range h.ExtraOptions {
		if strings.TrimSpace(option.Key) != "" && strings.TrimSpace(option.Value) != "" {
			lines = append(lines, "    "+option.Key+" "+option.Value)
		}
	}
	return lines
}

func renderPortForward(forward panelstore.PortForward) (string, bool) {
	kind := strings.ToLower(strings.TrimSpace(forward.Kind))
	if kind != "localforward" && kind != "remoteforward" && kind != "dynamicforward" {
		return "", false
	}
	if strings.TrimSpace(forward.Port) == "" {
		return "", false
	}
	listener := renderForwardEndpoint(forward.Bind, forward.Port)
	if kind == "dynamicforward" {
		return "DynamicForward " + listener, true
	}
	if strings.TrimSpace(forward.Target) == "" || strings.TrimSpace(forward.TargetPort) == "" {
		return "", false
	}
	target := renderForwardEndpoint(forward.Target, forward.TargetPort)
	name := "LocalForward"
	if kind == "remoteforward" {
		name = "RemoteForward"
	}
	return name + " " + listener + " " + target, true
}

func renderForwardEndpoint(host, port string) string {
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)
	if host == "" {
		return port
	}
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		host = "[" + host + "]"
	}
	return host + ":" + port
}

func hostsForGroup(hosts []panelstore.PanelHost, groupID string) []panelstore.PanelHost {
	out := make([]panelstore.PanelHost, 0)
	for _, h := range hosts {
		if h.GroupID == groupID {
			out = append(out, h)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Order != out[j].Order {
			return out[i].Order < out[j].Order
		}
		return out[i].Alias < out[j].Alias
	})
	return out
}

func validateState(state panelstore.State) error {
	if state.Version == 0 {
		state.Version = panelstore.CurrentVersion
	}
	seen := map[string]bool{}
	groups := map[string]bool{}
	for _, g := range state.Groups {
		if g.ID != g.Name {
			return fmt.Errorf("Panel 分组 ID 必须与分组名称一致: %s", g.ID)
		}
		if err := groupid.Validate(g.ID); err != nil {
			return err
		}
		groups[g.ID] = true
	}
	for _, h := range state.Hosts {
		if h.Alias == "" || seen[h.Alias] {
			return fmt.Errorf("生成配置时发现无效或重复 Host: %s", h.Alias)
		}
		seen[h.Alias] = true
		if h.GroupID != "" && !groups[h.GroupID] {
			return fmt.Errorf("主机 %s 的分组不存在: %s", h.Alias, h.GroupID)
		}
	}
	return nil
}

func hostMap(hosts []panelstore.PanelHost) map[string]panelstore.PanelHost {
	out := make(map[string]panelstore.PanelHost, len(hosts))
	for _, h := range hosts {
		out[h.Alias] = h
	}
	return out
}

func sameHost(a, b panelstore.PanelHost) bool {
	a.Password, b.Password = "", ""
	a.Note, b.Note = "", ""
	a.IdentityFiles = canonicalStringSlice(a.IdentityFiles)
	b.IdentityFiles = canonicalStringSlice(b.IdentityFiles)
	a.PortForwards = canonicalPortForwards(a.PortForwards)
	b.PortForwards = canonicalPortForwards(b.PortForwards)
	a.ExtraOptions = canonicalSSHOptions(a.ExtraOptions)
	b.ExtraOptions = canonicalSSHOptions(b.ExtraOptions)
	return reflect.DeepEqual(a, b)
}

// JSON omits empty slices, while the config parser naturally creates empty
// slices for directives that were not present. Treat both representations as
// the same semantic value so a stable config does not look externally edited.
func canonicalStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	return values
}

func canonicalPortForwards(values []panelstore.PortForward) []panelstore.PortForward {
	if len(values) == 0 {
		return nil
	}
	return values
}

func canonicalSSHOptions(values []panelstore.SSHOption) []panelstore.SSHOption {
	if len(values) == 0 {
		return nil
	}
	return values
}

func groupIDForPath(path string) string {
	path = filepath.ToSlash(path)
	if !strings.HasPrefix(path, "config.d/") || !strings.HasSuffix(path, ".conf") {
		return ""
	}
	return strings.TrimSuffix(strings.TrimPrefix(path, "config.d/"), ".conf")
}

func safeFileName(id string) string {
	var b strings.Builder
	for i := 0; i < len(id); i++ {
		ch := id[i]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' {
			b.WriteByte(ch)
		} else {
			b.WriteByte('-')
		}
	}
	if b.Len() == 0 {
		return "group"
	}
	return b.String()
}

func cleanRelative(path string) string { return filepath.ToSlash(filepath.Clean(path)) }

func relativeConfigPath(base, path string) string {
	rel, err := filepath.Rel(base, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(rel)
}

func includes(content string) []string {
	var out []string
	for _, raw := range splitLines(content) {
		key, value, ok := splitField(strings.TrimSpace(raw))
		if ok && strings.EqualFold(key, "include") {
			out = append(out, strings.Fields(value)...)
		}
	}
	return out
}

func expandInclude(dir, pattern string) ([]string, error) {
	pattern = strings.TrimSpace(strings.Trim(pattern, "\"'"))
	if strings.HasPrefix(pattern, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		pattern = filepath.Join(home, pattern[2:])
	} else if !filepath.IsAbs(pattern) {
		pattern = filepath.Join(dir, pattern)
	}
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("解析 Include 失败: %w", err)
	}
	sort.Strings(matches)
	return matches, nil
}

func splitField(line string) (string, string, bool) {
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	if i := strings.IndexByte(line, '='); i > 0 {
		return strings.TrimSpace(line[:i]), stripInlineComment(line[i+1:]), true
	}
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return "", "", false
	}
	key := fields[0]
	value := stripInlineComment(line[len(key):])
	return key, value, true
}

// stripInlineComment follows OpenSSH's useful subset of comment semantics:
// an unquoted # preceded by whitespace starts a comment. Raw lines are still
// retained in ConfigLayout, so removing the comment here only affects the
// structured PanelHost values used by Go connections and regeneration.
func stripInlineComment(value string) string {
	value = strings.TrimSpace(value)
	var quote byte
	escaped := false
	for i := 0; i < len(value); i++ {
		c := value[i]
		if escaped {
			escaped = false
			continue
		}
		if c == '\\' {
			escaped = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
			continue
		}
		if c == '#' && (i == 0 || value[i-1] == ' ' || value[i-1] == '\t') {
			return strings.TrimSpace(value[:i])
		}
	}
	return value
}

func splitLines(content string) []string {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	lines := strings.Split(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func joinLines(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n"
}

func hasGeneratedInclude(lines []string) bool {
	for _, line := range lines {
		key, value, ok := splitField(strings.TrimSpace(line))
		if ok && strings.EqualFold(key, "include") && strings.Trim(strings.TrimSpace(value), "\"'") == "~/.ssh/config.d/*" {
			return true
		}
	}
	return false
}

func unique(items []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	return out
}
