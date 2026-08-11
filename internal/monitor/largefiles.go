package monitor

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"
)

// LargeFile 磁盘上体积较大的普通文件
type LargeFile struct {
	Name string `json:"name"` // 文件名
	Dir  string `json:"dir"`  // 所在目录
	Path string `json:"path"` // 完整路径
	Size uint64 `json:"size"` // 字节
}

// LargeFilesResult 扫描结果
type LargeFilesResult struct {
	Files      []LargeFile `json:"files"`
	Incomplete bool        `json:"incomplete"` // 超时/截断
	Message    string      `json:"message,omitempty"`
	ElapsedMs  int64       `json:"elapsedMs"`
}

// CollectLargestFiles 在根分区扫描体积最大的 limit 个文件（异步调用方负责）
// 策略：
//   - 仅扫 /，-xdev 不跨设备
//   - 排除 /proc /sys /dev /run /snap /tmp 等
//   - 远端用 timeout 控制总时长，避免拖死会话
func (c *Collector) CollectLargestFiles(host string, opt sshd.ConnectOption, limit int) (LargeFilesResult, error) {
	start := time.Now()
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}

	// timeout 90s；find 排除虚拟/临时路径；printf 输出 size\tpath
	// 注意：部分精简系统无 GNU find -printf，失败时回退到 stat 方案
	script := fmt.Sprintf(`
set +e
LIMIT=%d
if command -v timeout >/dev/null 2>&1; then
  TO="timeout 90"
else
  TO=""
fi
# GNU find
OUT=$( $TO find / -xdev \
  \( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /snap -o -path '/tmp/*' -o -path /tmp -o -path /var/lib/docker -o -path '/var/lib/docker/*' \) -prune -o \
  -type f -printf '%%s\t%%p\n' 2>/dev/null | sort -nr | head -n "$LIMIT" )
EC=$?
if [ -n "$OUT" ]; then
  echo "$OUT"
  if [ $EC -eq 124 ]; then
    echo "__INCOMPLETE__"
  fi
  exit 0
fi
# 回退：BSD/busybox 无 -printf 时用 find + stat（更慢，同样 timeout）
OUT=$( $TO find / -xdev \
  \( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /snap -o -path /tmp -o -path /var/lib/docker \) -prune -o \
  -type f -print 2>/dev/null | head -n 80000 | while IFS= read -r f; do
    sz=$(stat -c '%%s' "$f" 2>/dev/null || stat -f '%%z' "$f" 2>/dev/null) || continue
    printf '%%s\t%%s\n' "$sz" "$f"
  done | sort -nr | head -n "$LIMIT" )
EC=$?
echo "$OUT"
if [ $EC -eq 124 ]; then
  echo "__INCOMPLETE__"
fi
`, limit)

	out, err := c.mgr.Run(host, opt, script, sshd.RunOptions{Timeout: 100 * time.Second})
	result := LargeFilesResult{ElapsedMs: time.Since(start).Milliseconds()}
	if err != nil {
		// 超时类错误：尽量解析已有 stdout
		if len(out) == 0 {
			return result, fmt.Errorf("扫描大文件失败: %w", err)
		}
		result.Incomplete = true
		result.Message = "扫描超时或中断，结果可能不完整"
	}

	text := string(out)
	lines := strings.Split(text, "\n")
	files := make([]LargeFile, 0, limit)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if line == "__INCOMPLETE__" {
			result.Incomplete = true
			result.Message = "扫描超时，仅返回已排序的部分结果"
			continue
		}
		// size \t path
		tab := strings.IndexByte(line, '\t')
		if tab < 0 {
			// 兼容空格分隔
			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}
			sz, e := strconv.ParseUint(parts[0], 10, 64)
			if e != nil {
				continue
			}
			p := strings.Join(parts[1:], " ")
			files = append(files, largeFileFrom(p, sz))
			continue
		}
		sz, e := strconv.ParseUint(line[:tab], 10, 64)
		if e != nil {
			continue
		}
		p := line[tab+1:]
		files = append(files, largeFileFrom(p, sz))
	}
	result.Files = files
	if len(files) == 0 && err != nil {
		return result, fmt.Errorf("扫描大文件失败: %w", err)
	}
	if len(files) == 0 {
		result.Message = "未找到可统计的文件（权限或路径被排除）"
	}
	return result, nil
}

func largeFileFrom(path string, size uint64) LargeFile {
	path = strings.TrimSpace(path)
	return LargeFile{
		Path: path,
		Name: filepath.Base(path),
		Dir:  filepath.Dir(path),
		Size: size,
	}
}
