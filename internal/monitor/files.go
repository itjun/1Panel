package monitor

import (
	"fmt"
	"path"
	"sort"
	"strings"

	"diteng-pannel/internal/sshd"
)

// FileEntry 目录中一个条目
type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`     // 绝对路径
	IsDir   bool   `json:"isDir"`
	Size    uint64 `json:"size"`     // 字节，目录为 0
	Mode    string `json:"mode"`     // 形如 "drwxr-xr-x"
	ModTime string `json:"modTime"`  // 形如 "2025-01-01 12:34"
	Owner   string `json:"owner"`    // 形如 "root"
	Group   string `json:"group"`
}

// ListDir 列出远程主机某目录下的内容
// 默认按目录在前、文件在后排序，再按名称字典序
func (c *Collector) ListDir(host string, opt sshd.ConnectOption, dir string) ([]FileEntry, error) {
	if dir == "" {
		dir = "/"
	}
	// 遍历目录，用 printf 输出每个条目的多字段信息
	// 字段顺序：name \037 type \037 size \037 mode \037 mtime \037 owner \037 group
	// 分隔符用 \037（US，八进制 037 = 0x1F）：printf 会解释八进制转义，输出真正的 US 字节
	// 选择 US 是因为它绝不会出现在文件名/路径/mtime 等正常文本中
	// 注意：不能用 stat -c '...\x1f...'，因为 stat 的格式串不解析 \x 转义，会原样输出字面字符
	cmd := fmt.Sprintf(
		`cd %q 2>/dev/null && for f in *; do
		   if [ -e "$f" ]; then
		     st=$(stat -c '%%n|%%F|%%s|%%A|%%y|%%U|%%G' "$f" 2>/dev/null)
		     if [ -n "$st" ]; then
		       printf '%%s\n' "$(echo "$st" | tr '|' '\037')"
		     fi
		   fi
		 done`,
		dir,
	)
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	entries := parseDirEntries(string(out), dir)
	// 排序：目录在前，再按名字
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}

// parseDirEntries 解析 stat 输出
// 每行：name \x1f type \x1f size \x1f mode \x1f mtime \x1f owner \x1f group
// 字段由 \x1f（US，0x1F）分隔，由远程 printf '\037' 产生
func parseDirEntries(s, baseDir string) []FileEntry {
	out := []FileEntry{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\x1f")
		if len(fields) < 7 {
			continue
		}
		name := fields[0]
		isDir := strings.HasPrefix(fields[1], "directory")
		size, _ := parseUint(fields[2])
		// mtime 形如 "2025-01-01 12:34:56.000000000 +0800"，截短到秒
		mtime := fields[4]
		if len(mtime) > 19 {
			mtime = mtime[:19]
		}
		out = append(out, FileEntry{
			Name:    name,
			Path:    path.Join(baseDir, name),
			IsDir:   isDir,
			Size:    size,
			Mode:    fields[3],
			ModTime: mtime,
			Owner:   fields[5],
			Group:   fields[6],
		})
	}
	return out
}

// ReadFileText 读远程文本文件，限制最大 size 字节（避免拉巨型文件卡住）
// 只读：用 cat，不做任何写操作
func (c *Collector) ReadFileText(host string, opt sshd.ConnectOption, file string, maxSize int) (string, error) {
	if maxSize <= 0 {
		maxSize = 512 * 1024 // 默认上限 512KB
	}
	// 先用 stat 校验是普通文件，避免读到目录或设备
	// 再 head -c maxSize 防止超大文件
	cmd := fmt.Sprintf(
		`if [ -f %q ]; then head -c %d %q; else echo "ERROR: not a regular file"; fi`,
		file, maxSize, file,
	)
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// StatPath 返回单个路径的 FileEntry（用于判断根目录是否可访问）
func (c *Collector) StatPath(host string, opt sshd.ConnectOption, p string) (*FileEntry, error) {
	// 用 | 作为 stat 的字段分隔（stat 不解析 \x 转义），再用 tr 转成 US 字节
	cmd := fmt.Sprintf(
		`st=$(stat -c '%%n|%%F|%%s|%%A|%%y|%%U|%%G' %q 2>/dev/null) && printf '%%s' "$(echo "$st" | tr '|' '\037')"`,
		p,
	)
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	entries := parseDirEntries(string(out), path.Dir(p))
	if len(entries) == 0 {
		return nil, fmt.Errorf("路径不存在或无访问权限: %s", p)
	}
	return &entries[0], nil
}

func parseUint(s string) (uint64, error) {
	var n uint64
	for _, c := range strings.TrimSpace(s) {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("invalid uint: %q", s)
		}
		n = n*10 + uint64(c-'0')
	}
	return n, nil
}
