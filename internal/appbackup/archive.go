// Package appbackup stores complete application snapshots independently of the
// older host-only portable format. Archives never contain executable caches.
package appbackup

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"diteng-pannel/internal/panelstore"
)

const Format = "1panel-application-data"
const maxFile = 128 << 20
const maxTotal = 512 << 20

type Entry struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Mode   uint32 `json:"mode"`
	Text   bool   `json:"text,omitempty"`
}

type Manifest struct {
	Format        string            `json:"format"`
	Version       int               `json:"version"`
	CreatedAt     int64             `json:"createdAt"`
	SourceOS      string            `json:"sourceOS"`
	SourceHome    string            `json:"sourceHome"`
	SourceDataDir string            `json:"sourceDataDir"`
	Hosts         int               `json:"hosts"`
	Groups        int               `json:"groups"`
	Preferences   map[string]string `json:"preferences"`
	Relocations   map[string]string `json:"relocations,omitempty"`
	Entries       []Entry           `json:"entries"`
}

type Snapshot struct {
	Manifest Manifest
	Files    map[string][]byte
}

func Hash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func validPath(p string) bool {
	return p != "" && path.Clean(p) == p && !strings.ContainsAny(p, "\\:\x00") &&
		!strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "../") &&
		(strings.HasPrefix(p, "data/") || strings.HasPrefix(p, "ssh/")) &&
		p != "data/" && p != "ssh/" && !Excluded(strings.TrimPrefix(p, "data/"))
}

// Excluded contains only generated/downloaded binaries, temporary writes and
// this feature's own archives/staging. Historical configuration snapshots stay.
func Excluded(rel string) bool {
	first := strings.Split(filepath.ToSlash(rel), "/")[0]
	return first == "application-backups" || first == ".application-restore" ||
		first == "update" || first == "iperf3" || strings.HasSuffix(rel, ".tmp")
}

func (s *Snapshot) Add(p string, b []byte, mode os.FileMode, text bool) error {
	if !validPath(p) || len(b) > maxFile {
		return fmt.Errorf("备份文件无效或超过 128 MB: %s", p)
	}
	if s.Files == nil {
		s.Files = map[string][]byte{}
	}
	if _, exists := s.Files[p]; exists {
		return fmt.Errorf("备份文件重复: %s", p)
	}
	s.Files[p] = b
	s.Manifest.Entries = append(s.Manifest.Entries, Entry{p, Hash(b), uint32(mode.Perm()), text})
	return nil
}

func (s *Snapshot) Validate() error {
	m := s.Manifest
	if m.Format != Format || m.Version != 1 || m.Preferences == nil {
		return fmt.Errorf("这不是完整的应用数据备份，请选择新版“备份应用数据”生成的文件")
	}
	if _, ok := s.Files["data/panel.json"]; !ok {
		return fmt.Errorf("备份缺少应用配置")
	}
	if err := panelstore.ValidateSnapshot(s.Files["data/panel.json"]); err != nil {
		return fmt.Errorf("备份主机配置无效: %w", err)
	}
	seen := map[string]bool{}
	total := 0
	for _, e := range m.Entries {
		key := strings.ToLower(e.Path)
		if !validPath(e.Path) || seen[key] {
			return fmt.Errorf("备份路径无效或重复: %s", e.Path)
		}
		seen[key] = true
		b, ok := s.Files[e.Path]
		if !ok || Hash(b) != e.SHA256 || len(b) > maxFile {
			return fmt.Errorf("备份文件校验失败: %s", e.Path)
		}
		total += len(b)
		if total > maxTotal {
			return fmt.Errorf("备份数据超过 512 MB")
		}
	}
	if len(seen) != len(s.Files) {
		return fmt.Errorf("备份清单与文件不一致")
	}
	for key := range m.Preferences {
		if !PreferenceKey(key) {
			return fmt.Errorf("备份偏好键无效: %s", key)
		}
	}
	return nil
}

// Inspect reads only metadata for a responsive backup list. Full checksum and
// payload validation happens again on preview and immediately before restore.
func Inspect(src string) (*Snapshot, error) {
	z, err := zip.OpenReader(src)
	if err != nil {
		return nil, err
	}
	defer z.Close()
	for _, e := range z.File {
		if e.Name != "manifest.json" {
			continue
		}
		if e.UncompressedSize64 > 8<<20 {
			return nil, fmt.Errorf("备份清单过大")
		}
		r, err := e.Open()
		if err != nil {
			return nil, err
		}
		b, err := io.ReadAll(io.LimitReader(r, (8<<20)+1))
		r.Close()
		if err != nil {
			return nil, err
		}
		if len(b) > 8<<20 {
			return nil, fmt.Errorf("备份清单过大")
		}
		var m Manifest
		if err := json.Unmarshal(b, &m); err != nil {
			return nil, err
		}
		if m.Format != Format || m.Version != 1 {
			return nil, fmt.Errorf("不是完整的应用数据备份")
		}
		return &Snapshot{Manifest: m}, nil
	}
	return nil, fmt.Errorf("备份缺少清单")
}

func PreferenceKey(key string) bool {
	return strings.HasPrefix(key, "1pannel-") || strings.HasPrefix(key, "1pannel.") ||
		strings.HasPrefix(key, "ipannel.") || strings.HasPrefix(key, "ipannel-")
}

func Write(dst string, s *Snapshot) (err error) {
	s.Manifest.Format, s.Manifest.Version = Format, 1
	if err = s.Validate(); err != nil {
		return err
	}
	sort.Slice(s.Manifest.Entries, func(i, j int) bool { return s.Manifest.Entries[i].Path < s.Manifest.Entries[j].Path })
	if err = os.MkdirAll(filepath.Dir(dst), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(dst), ".application-backup-*.tmp")
	if err != nil {
		return err
	}
	defer func() { f.Close(); os.Remove(f.Name()) }()
	z := zip.NewWriter(f)
	manifest, err := json.MarshalIndent(s.Manifest, "", "  ")
	if err != nil {
		return err
	}
	if len(manifest) > 8<<20 {
		return fmt.Errorf("应用偏好与备份清单超过 8 MB，无法生成完整备份")
	}
	w, err := z.Create("manifest.json")
	if err != nil {
		return err
	}
	if _, err = w.Write(manifest); err != nil {
		return err
	}
	for _, e := range s.Manifest.Entries {
		h := &zip.FileHeader{Name: e.Path, Method: zip.Deflate}
		h.SetMode(0600)
		w, err = z.CreateHeader(h)
		if err != nil {
			return err
		}
		if _, err = w.Write(s.Files[e.Path]); err != nil {
			return err
		}
	}
	if err = z.Close(); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	// Refuse replacement here: callers use unique filenames for local snapshots.
	if _, err = os.Lstat(dst); err == nil {
		return fmt.Errorf("备份文件已存在，请选择其他文件名")
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.Rename(f.Name(), dst)
}

func Read(src string) (*Snapshot, string, error) {
	f, err := os.Open(src)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, "", err
	}
	if info.Size() > maxTotal {
		return nil, "", fmt.Errorf("备份文件超过 512 MB")
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return nil, "", err
	}
	z, err := zip.NewReader(f, info.Size())
	if err != nil {
		return nil, "", fmt.Errorf("无法读取应用数据备份: %w", err)
	}
	s := &Snapshot{Files: map[string][]byte{}}
	seen := map[string]bool{}
	total := 0
	for _, e := range z.File {
		if seen[strings.ToLower(e.Name)] || e.Mode()&os.ModeType != 0 || len(seen) >= 10000 {
			return nil, "", fmt.Errorf("备份包含重复或非法文件")
		}
		seen[strings.ToLower(e.Name)] = true
		if e.Name != "manifest.json" && !validPath(e.Name) {
			return nil, "", fmt.Errorf("备份路径无效: %s", e.Name)
		}
		limit := int64(maxFile)
		if e.Name == "manifest.json" {
			limit = 8 << 20
		}
		if e.UncompressedSize64 > uint64(limit) {
			return nil, "", fmt.Errorf("备份条目过大: %s", e.Name)
		}
		r, err := e.Open()
		if err != nil {
			return nil, "", err
		}
		b, readErr := io.ReadAll(io.LimitReader(r, limit+1))
		r.Close()
		if readErr != nil {
			return nil, "", readErr
		}
		if int64(len(b)) > limit {
			return nil, "", fmt.Errorf("备份条目过大")
		}
		total += len(b)
		if total > maxTotal {
			return nil, "", fmt.Errorf("备份数据超过 512 MB")
		}
		if e.Name == "manifest.json" {
			if err := json.Unmarshal(b, &s.Manifest); err != nil {
				return nil, "", err
			}
			if s.Manifest.Format != Format || s.Manifest.Version != 1 {
				return nil, "", fmt.Errorf("这不是完整的应用数据备份，请选择新版“备份应用数据”生成的文件")
			}
		} else {
			s.Files[e.Name] = b
		}
	}
	if err := s.Validate(); err != nil {
		return nil, "", err
	}
	return s, hex.EncodeToString(h.Sum(nil)), nil
}
