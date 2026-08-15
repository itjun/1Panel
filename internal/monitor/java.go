package monitor

import (
	"fmt"
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// JavaProcDetail 单个运行时进程的补充详情（悬浮卡片按需查询）
type JavaProcDetail struct {
	PID        uint32 `json:"pid"`
	WorkDir    string `json:"workDir"`    // /proc/<pid>/cwd
	ExePath    string `json:"exePath"`    // /proc/<pid>/exe（可执行文件真实路径）
	ReadBytes  uint64 `json:"readBytes"`  // /proc/<pid>/io 累计读（无权限时为 0）
	WriteBytes uint64 `json:"writeBytes"` // 累计写
}

// jarFromArgs 从命令行提取 -jar 的包路径；没有 -jar 时找第一个 *.jar 参数
func jarFromArgs(args string) string {
	fields := strings.Fields(args)
	for i, f := range fields {
		if f == "-jar" && i+1 < len(fields) {
			return fields[i+1]
		}
	}
	for _, f := range fields {
		if strings.HasSuffix(f, ".jar") {
			return f
		}
	}
	return ""
}

// heapFromArgs 从命令行解析初始/最大堆大小（-Xms / -Xmx / -XX:InitialHeapSize= / -XX:MaxHeapSize=）
// 未显式设置时返回 0（JVM 会取默认值，默认值只能进进程内部才知道）
func heapFromArgs(args string) (xms, xmx uint64) {
	for _, f := range strings.Fields(args) {
		switch {
		case strings.HasPrefix(f, "-Xms"):
			xms = parseJvmMemBytes(f[4:])
		case strings.HasPrefix(f, "-Xmx"):
			xmx = parseJvmMemBytes(f[4:])
		case strings.HasPrefix(f, "-XX:InitialHeapSize="):
			xms = parseJvmMemBytes(f[len("-XX:InitialHeapSize="):])
		case strings.HasPrefix(f, "-XX:MaxHeapSize="):
			xmx = parseJvmMemBytes(f[len("-XX:MaxHeapSize="):])
		}
	}
	return xms, xmx
}

// parseJvmMemBytes JVM 内存参数值 → bytes："4g" / "512m" / "1024k" / "268435456"（K/M/G 按二进制 1024 进位）
func parseJvmMemBytes(v string) uint64 {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	mult := uint64(1)
	switch v[len(v)-1] {
	case 'k', 'K':
		mult, v = 1024, v[:len(v)-1]
	case 'm', 'M':
		mult, v = 1024*1024, v[:len(v)-1]
	case 'g', 'G':
		mult, v = 1024*1024*1024, v[:len(v)-1]
	}
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return 0
	}
	return n * mult
}

// CollectJavaProcDetail 悬浮卡片触发的按需详情：工作目录 / 可执行路径 / 磁盘 IO
// 注意：readlink/cat 在权限不足时以非零退出码结束，SSH 层会把整条命令判为失败，
// 所以每段跟 || true 兜底，保证命令整体退出码为 0、已拿到的字段正常返回
func (c *Collector) CollectJavaProcDetail(host string, pid uint32, opt sshd.ConnectOption) (JavaProcDetail, error) {
	if pid == 0 {
		return JavaProcDetail{}, fmt.Errorf("非法 PID")
	}
	out, err := c.mgr.Run(host, opt, fmt.Sprintf(
		`echo =CWD=; readlink /proc/%d/cwd 2>/dev/null || true; echo =EXE=; readlink /proc/%d/exe 2>/dev/null || true; echo =IO=; cat /proc/%d/io 2>/dev/null; true`,
		pid, pid, pid,
	))
	if err != nil {
		return JavaProcDetail{}, err
	}
	d := JavaProcDetail{PID: pid}
	sec := splitSections(string(out))
	d.WorkDir = sec["CWD"]
	d.ExePath = sec["EXE"]
	for _, line := range strings.Split(sec["IO"], "\n") {
		kv := strings.SplitN(strings.TrimSpace(line), ":", 2)
		if len(kv) != 2 {
			continue
		}
		v, _ := strconv.ParseUint(strings.TrimSpace(kv[1]), 10, 64)
		switch kv[0] {
		case "read_bytes":
			d.ReadBytes = v
		case "write_bytes":
			d.WriteBytes = v
		}
	}
	return d, nil
}
