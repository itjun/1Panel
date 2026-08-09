package monitor

import (
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// CollectDisks 采集磁盘容量信息（df -B1 拿到字节数）
// 过滤掉容器内部挂载点、虚拟文件系统，只保留真实分区
func (c *Collector) CollectDisks(host string, opt sshd.ConnectOption) ([]DiskInfo, error) {
	// -B1 让 df 输出以字节为单位
	// -x 排除常见虚拟/网络/容器文件系统
	// 后续再二次过滤 docker overlay2/merged 等容器挂载点
	cmd := "df -B1 -x tmpfs -x devtmpfs -x squashfs -x overlay -x overlay2 2>/dev/null"
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	disks := parseDisks(string(out))
	// 二次过滤：去除 docker 容器挂载点、snap loopback、容器 merged 等
	filtered := disks[:0]
	for _, d := range disks {
		if shouldSkipMount(d.Mount) {
			continue
		}
		filtered = append(filtered, d)
	}
	return filtered, nil
}

// shouldSkipMount 判断一个挂载点是否应该从磁盘列表中隐藏
// 隐藏：docker 容器、snap 包内部、kubelet/PodMAN 等
func shouldSkipMount(mount string) bool {
	skipPrefixes := []string{
		"/var/lib/docker/",       // docker 容器/卷/镜像
		"/var/lib/containers/",   // podman
		"/var/lib/kubelet/",      // kubernetes
		"/var/lib/snapd/",        // snap
		"/snap/",                 // snap 挂载
		"/run/containerd/",       // containerd
	}
	for _, p := range skipPrefixes {
		if strings.HasPrefix(mount, p) {
			return true
		}
	}
	return false
}

func parseDisks(s string) []DiskInfo {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) <= 1 {
		return nil
	}
	out := make([]DiskInfo, 0, len(lines)-1)
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		total, _ := strconv.ParseUint(fields[1], 10, 64)
		used, _ := strconv.ParseUint(fields[2], 10, 64)
		avail, _ := strconv.ParseUint(fields[3], 10, 64)
		pctRaw := strings.TrimSuffix(fields[4], "%")
		p, _ := strconv.ParseFloat(pctRaw, 64)
		out = append(out, DiskInfo{
			Filesystem: fields[0],
			Mount:      fields[5],
			Total:      total,
			Used:       used,
			Avail:      avail,
			Percent:    p,
		})
	}
	return out
}
