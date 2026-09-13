//go:build darwin

package localsys

import (
	"regexp"
	"strconv"
	"strings"
)

var (
	reIOBytesRead  = regexp.MustCompile(`"Bytes \(Read\)"=(\d+)`)
	reIOBytesWrite = regexp.MustCompile(`"Bytes \(Write\)"=(\d+)`)
	reIOOpsRead    = regexp.MustCompile(`"Operations \(Read\)"=(\d+)`)
	reIOOpsWrite   = regexp.MustCompile(`"Operations \(Write\)"=(\d+)`)
)

// fillNetDiskCounters 填充 Overview 的网卡 / 磁盘累计字节（供前端差分算速率）。
func fillNetDiskCounters(o *Overview) {
	o.NetRxBytes, o.NetTxBytes = primaryNetBytes()
	o.DiskReadBytes, o.DiskWriteBytes, o.DiskIOCount = diskIOTotals()
}

// primaryNetBytes 优先默认路由网卡；失败则合计非 lo / 非 utun 等虚拟口。
func primaryNetBytes() (rx, tx uint64) {
	bytesMap := parseNetstatIB(runCmd("netstat", "-ibn"))
	_, iface := parseDefaultRoute(runCmd("route", "-n", "get", "default"))
	if iface != "" {
		if b, ok := bytesMap[iface]; ok {
			return b.rx, b.tx
		}
	}
	for name, b := range bytesMap {
		if shouldSkipNetDev(name) {
			continue
		}
		rx += b.rx
		tx += b.tx
	}
	return rx, tx
}

func shouldSkipNetDev(name string) bool {
	n := strings.ToLower(name)
	if n == "lo0" || n == "lo" {
		return true
	}
	if strings.HasPrefix(n, "utun") || strings.HasPrefix(n, "awdl") || strings.HasPrefix(n, "llw") {
		return true
	}
	if strings.HasPrefix(n, "bridge") || strings.HasPrefix(n, "ap") {
		return true
	}
	return false
}

// diskIOTotals 读 IOBlockStorageDriver 累计读写（ioreg）；多盘合计。
func diskIOTotals() (read, write, ops uint64) {
	raw := runCmd("ioreg", "-c", "IOBlockStorageDriver", "-d", "3", "-r")
	return parseIORegDiskStats(raw)
}

func parseIORegDiskStats(raw string) (read, write, ops uint64) {
	for _, m := range reIOBytesRead.FindAllStringSubmatch(raw, -1) {
		if n, err := strconv.ParseUint(m[1], 10, 64); err == nil {
			read += n
		}
	}
	for _, m := range reIOBytesWrite.FindAllStringSubmatch(raw, -1) {
		if n, err := strconv.ParseUint(m[1], 10, 64); err == nil {
			write += n
		}
	}
	for _, m := range reIOOpsRead.FindAllStringSubmatch(raw, -1) {
		if n, err := strconv.ParseUint(m[1], 10, 64); err == nil {
			ops += n
		}
	}
	for _, m := range reIOOpsWrite.FindAllStringSubmatch(raw, -1) {
		if n, err := strconv.ParseUint(m[1], 10, 64); err == nil {
			ops += n
		}
	}
	return read, write, ops
}
