package agentres

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	versionFileName = "VERSION"
	stampFileName   = "SOURCE.sha256"
)

// ModuleRoot 从 dir 向上找到含 go.mod 的目录。
func ModuleRoot(dir string) (string, error) {
	if dir == "" {
		var err error
		dir, err = os.Getwd()
		if err != nil {
			return "", err
		}
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("未找到 go.mod")
		}
		dir = parent
	}
}

// ReadAgentVersion 读 internal/agentres/VERSION（去空白）。
func ReadAgentVersion(root string) (string, error) {
	b, err := os.ReadFile(filepath.Join(root, "internal", "agentres", versionFileName))
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(b))
	if v == "" {
		return "", fmt.Errorf("VERSION 为空")
	}
	return v, nil
}

// HashAgentSources 对 spanel-agent 运行时源码做稳定哈希（不含 *_test.go）。
func HashAgentSources(root string) (string, error) {
	var files []string
	roots := []string{
		filepath.Join(root, "cmd", "spanel-agent"),
		filepath.Join(root, "internal", "agent"),
		filepath.Join(root, "internal", "agentapi"), // HTTP JSON 契约；改 tag 必须重编 agent
		// agent 链入的采集实现；改这里也必须升 agent 版本并重编
		filepath.Join(root, "internal", "monitor"),
	}
	for _, dir := range roots {
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}
			if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			files = append(files, filepath.ToSlash(rel))
			return nil
		})
		if err != nil {
			return "", err
		}
	}
	if len(files) == 0 {
		return "", fmt.Errorf("没有找到 spanel-agent 源码")
	}
	sort.Strings(files)

	h := sha256.New()
	for _, rel := range files {
		if _, err := io.WriteString(h, rel+"\n"); err != nil {
			return "", err
		}
		b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			return "", err
		}
		if _, err := h.Write(b); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// ReadSourceStamp 读 SOURCE.sha256：`<hash> <version>`。文件不存在时 hash、ver 为空。
func ReadSourceStamp(root string) (hash, version string, err error) {
	b, err := os.ReadFile(filepath.Join(root, "internal", "agentres", stampFileName))
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", nil
		}
		return "", "", err
	}
	line := strings.TrimSpace(string(b))
	hash, version, _ = strings.Cut(line, " ")
	hash = strings.TrimSpace(hash)
	version = strings.TrimSpace(version)
	return hash, version, nil
}

func writeVersionAndStamp(root, version, hash string) error {
	dir := filepath.Join(root, "internal", "agentres")
	if err := os.WriteFile(filepath.Join(dir, versionFileName), []byte(version+"\n"), 0o644); err != nil {
		return err
	}
	stamp := hash + " " + version + "\n"
	return os.WriteFile(filepath.Join(dir, stampFileName), []byte(stamp), 0o644)
}

func bumpPatch(ver string) (string, error) {
	parts := strings.Split(ver, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("版本号须为 x.y.z，实际 %q", ver)
	}
	var n int
	if _, err := fmt.Sscanf(parts[2], "%d", &n); err != nil {
		return "", fmt.Errorf("版本号补丁段无效: %q", parts[2])
	}
	return fmt.Sprintf("%s.%s.%d", parts[0], parts[1], n+1), nil
}

// SyncAgentVersion 源码哈希变了就升补丁号（若 VERSION 已被人手改过则只刷新戳）。
// 返回最终版本、是否升号、说明。
func SyncAgentVersion(root string) (version string, bumped bool, msg string, err error) {
	hash, err := HashAgentSources(root)
	if err != nil {
		return "", false, "", err
	}
	version, err = ReadAgentVersion(root)
	if err != nil {
		return "", false, "", err
	}
	oldHash, stampedVer, err := ReadSourceStamp(root)
	if err != nil {
		return "", false, "", err
	}
	if oldHash == "" {
		if err := writeVersionAndStamp(root, version, hash); err != nil {
			return "", false, "", err
		}
		return version, false, "首次记录源码哈希，版本 " + version, nil
	}
	if oldHash == hash {
		return version, false, "源码未变，版本 " + version, nil
	}
	if version != stampedVer {
		if err := writeVersionAndStamp(root, version, hash); err != nil {
			return "", false, "", err
		}
		return version, false, "源码已变且 VERSION 已手动改为 " + version + "，只刷新哈希", nil
	}
	next, err := bumpPatch(version)
	if err != nil {
		return "", false, "", err
	}
	if err := writeVersionAndStamp(root, next, hash); err != nil {
		return "", false, "", err
	}
	return next, true, "spanel-agent 源码已变，版本 " + version + " → " + next, nil
}
