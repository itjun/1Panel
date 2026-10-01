package portable

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"diteng-pannel/internal/hosticon"
	"diteng-pannel/internal/panelstore"
)

const (
	// Format manifest.json 中的格式标识，用于区分普通 zip
	Format = "1panel-portable"
	// Version 当前迁移包版本；v1 为旧版单 JSON 备份
	Version = 2

	manifestName   = "manifest.json"
	knownHostsName = "known_hosts"
	keysPrefix     = "keys/"
	rawConfigDir   = "raw-config/"

	maxEntrySize = 32 << 20
	maxTotalSize = 128 << 20
)

// ErrNotPortable zip 中没有可识别的 1Panel manifest
var ErrNotPortable = errors.New("不是 1Panel 备份文件")

// KeyEntry 迁移包中的一个密钥文件；RelPath 为相对 home 的正斜杠路径
type KeyEntry struct {
	ArchivePath string `json:"archivePath"`
	RelPath     string `json:"relPath"`
	Mode        uint32 `json:"mode,omitempty"`
	SHA256      string `json:"sha256"`
}

// Manifest 迁移包清单。Hosts 中的密码为明文，IdentityFiles 已归一化为 `~/` 形式。
type Manifest struct {
	Format     string                  `json:"format"`
	Version    int                     `json:"version"`
	CreatedAt  int64                   `json:"createdAt"`
	SourceOS   string                  `json:"sourceOS"`
	Hosts      []panelstore.PanelHost  `json:"hosts"`
	Groups     []panelstore.PanelGroup `json:"groups"`
	Icons      []hosticon.Record       `json:"icons,omitempty"`
	Keys       []KeyEntry              `json:"keys,omitempty"`
	KnownHosts bool                    `json:"knownHosts,omitempty"`
	RawConfig  []string                `json:"rawConfig,omitempty"`
}

// Archive 内存中的完整迁移包；Keys 与 RawConfig 以 zip 条目名为键
type Archive struct {
	Manifest   Manifest
	Keys       map[string][]byte
	KnownHosts []byte
	RawConfig  map[string][]byte
}

// AddKey 以 relPath（相对 home）登记一个密钥文件，返回其 zip 条目名
func (a *Archive) AddKey(relPath string, content []byte, mode uint32) (string, error) {
	if !SafeRel(relPath) {
		return "", fmt.Errorf("密钥路径无效: %s", relPath)
	}
	name := keysPrefix + relPath
	if a.Keys == nil {
		a.Keys = map[string][]byte{}
	}
	if _, ok := a.Keys[name]; ok {
		return name, nil
	}
	a.Keys[name] = content
	a.Manifest.Keys = append(a.Manifest.Keys, KeyEntry{
		ArchivePath: name, RelPath: relPath, Mode: mode, SHA256: panelstore.SHA256(content),
	})
	return name, nil
}

// AddRawConfig 登记一份原始 SSH 配置（仅供参考，恢复时不使用）
func (a *Archive) AddRawConfig(rel string, content []byte) {
	rel = toSlash(rel)
	if !SafeRel(rel) {
		rel = "external/" + safeBase(rel)
	}
	name := rawConfigDir + rel
	if a.RawConfig == nil {
		a.RawConfig = map[string][]byte{}
	}
	a.RawConfig[name] = content
	a.Manifest.RawConfig = append(a.Manifest.RawConfig, name)
}

// Write 原子写出迁移包：先写同目录临时文件再重命名，权限 0600，拒绝覆盖符号链接
func Write(dst string, a *Archive) error {
	if a == nil {
		return fmt.Errorf("迁移包为空")
	}
	a.Manifest.Format = Format
	a.Manifest.Version = Version
	a.Manifest.KnownHosts = len(a.KnownHosts) > 0
	sort.Slice(a.Manifest.Keys, func(i, j int) bool { return a.Manifest.Keys[i].ArchivePath < a.Manifest.Keys[j].ArchivePath })
	sort.Strings(a.Manifest.RawConfig)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	manifest, err := json.MarshalIndent(a.Manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化 manifest 失败: %w", err)
	}
	if err := writeEntry(zw, manifestName, manifest); err != nil {
		return err
	}
	for _, k := range a.Manifest.Keys {
		if err := writeEntry(zw, k.ArchivePath, a.Keys[k.ArchivePath]); err != nil {
			return err
		}
	}
	if len(a.KnownHosts) > 0 {
		if err := writeEntry(zw, knownHostsName, a.KnownHosts); err != nil {
			return err
		}
	}
	for _, name := range a.Manifest.RawConfig {
		if err := writeEntry(zw, name, a.RawConfig[name]); err != nil {
			return err
		}
	}
	if err := zw.Close(); err != nil {
		return fmt.Errorf("打包失败: %w", err)
	}

	dst = filepath.Clean(dst)
	if info, err := os.Lstat(dst); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("拒绝覆盖符号链接: %s", dst)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0700); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".1panel-backup-*.zip")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(buf.Bytes()); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("写入备份失败: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, dst); err != nil {
		// Windows 上目标已存在时 Rename 可能失败，先删再换
		if _, statErr := os.Stat(dst); statErr == nil {
			if rmErr := os.Remove(dst); rmErr != nil {
				return fmt.Errorf("替换备份文件失败: %w", err)
			}
			if err := os.Rename(tmpName, dst); err != nil {
				return fmt.Errorf("替换备份文件失败: %w", err)
			}
			return nil
		}
		return fmt.Errorf("替换备份文件失败: %w", err)
	}
	return nil
}

// Read 读取并校验迁移包。条目名越界、manifest 缺失或格式不符均报错。
func Read(src string) (*Archive, error) {
	zr, err := zip.OpenReader(src)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNotPortable, err)
	}
	defer zr.Close()
	return readZip(&zr.Reader)
}

func readZip(zr *zip.Reader) (*Archive, error) {
	entries := make(map[string][]byte, len(zr.File))
	var total int64
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if !SafeRel(f.Name) {
			return nil, fmt.Errorf("备份包含非法路径: %s", f.Name)
		}
		if f.UncompressedSize64 > maxEntrySize {
			return nil, fmt.Errorf("备份条目过大: %s", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("读取备份条目 %s 失败: %w", f.Name, err)
		}
		b, err := io.ReadAll(io.LimitReader(rc, maxEntrySize+1))
		_ = rc.Close()
		if err != nil {
			return nil, fmt.Errorf("读取备份条目 %s 失败: %w", f.Name, err)
		}
		if len(b) > maxEntrySize {
			return nil, fmt.Errorf("备份条目过大: %s", f.Name)
		}
		total += int64(len(b))
		if total > maxTotalSize {
			return nil, fmt.Errorf("备份文件过大")
		}
		entries[f.Name] = b
	}
	raw, ok := entries[manifestName]
	if !ok {
		return nil, ErrNotPortable
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil || m.Format != Format {
		return nil, ErrNotPortable
	}
	if m.Version > Version {
		return nil, fmt.Errorf("备份版本过高: %d（当前支持 %d），请升级应用", m.Version, Version)
	}
	a := &Archive{Manifest: m, Keys: map[string][]byte{}, RawConfig: map[string][]byte{}}
	for _, k := range m.Keys {
		if !SafeRel(k.RelPath) || !strings.HasPrefix(k.ArchivePath, keysPrefix) {
			return nil, fmt.Errorf("备份密钥路径无效: %s", k.RelPath)
		}
		b, ok := entries[k.ArchivePath]
		if !ok {
			return nil, fmt.Errorf("备份缺少密钥文件: %s", k.ArchivePath)
		}
		if k.SHA256 != "" && panelstore.SHA256(b) != k.SHA256 {
			return nil, fmt.Errorf("密钥文件校验失败: %s", k.ArchivePath)
		}
		a.Keys[k.ArchivePath] = b
	}
	if m.KnownHosts {
		a.KnownHosts = entries[knownHostsName]
	}
	for _, name := range m.RawConfig {
		if b, ok := entries[name]; ok {
			a.RawConfig[name] = b
		}
	}
	return a, nil
}

func writeEntry(zw *zip.Writer, name string, content []byte) error {
	if !SafeRel(name) {
		return fmt.Errorf("打包路径无效: %s", name)
	}
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = w.Write(content)
	return err
}

// IsZip 依据文件头判断是否 zip（不依赖后缀）
func IsZip(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 4)
	if _, err := io.ReadFull(f, head); err != nil {
		return false
	}
	return bytes.Equal(head, []byte("PK\x03\x04")) || bytes.Equal(head, []byte("PK\x05\x06"))
}

// MergeKnownHosts 把 incoming 中本地没有的条目追加到 local 末尾，返回新内容与新增行数。
// 比较按去首尾空白后的整行；注释与空行不迁移。
func MergeKnownHosts(local, incoming []byte) ([]byte, int) {
	seen := map[string]bool{}
	for _, line := range splitLines(local) {
		if t := strings.TrimSpace(line); t != "" {
			seen[t] = true
		}
	}
	var add []string
	for _, line := range splitLines(incoming) {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") || seen[t] {
			continue
		}
		seen[t] = true
		add = append(add, t)
	}
	if len(add) == 0 {
		return local, 0
	}
	out := append([]byte(nil), local...)
	if len(out) > 0 && out[len(out)-1] != '\n' {
		out = append(out, '\n')
	}
	out = append(out, []byte(strings.Join(add, "\n")+"\n")...)
	return out, len(add)
}

func splitLines(b []byte) []string {
	s := strings.ReplaceAll(string(b), "\r\n", "\n")
	return strings.Split(s, "\n")
}
