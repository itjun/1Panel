package monitor

import (
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// CollectDisks 采集磁盘容量信息（df -B1 拿到字节数）
func (c *Collector) CollectDisks(host string, opt sshd.ConnectOption) ([]DiskInfo, error) {
	// -B1 让 df 输出以字节为单位，避免按块大小换算
	out, err := c.mgr.Run(host, opt, "df -B1 -x tmpfs -x devtmpfs -x squashfs")
	if err != nil {
		return nil, err
	}
	return parseDisks(string(out)), nil
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
