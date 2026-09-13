package localsys

import (
	"regexp"
	"strconv"
	"strings"
)

// ParseSwapUsage 解析 macOS `sysctl vm.swapusage` 输出。
// 例：total = 3072.00M  used = 2320.94M  free = 751.06M  (encrypted)
func ParseSwapUsage(raw string) (total, used uint64, ok bool) {
	re := regexp.MustCompile(`(?i)total\s*=\s*([\d.]+)\s*([KMGT]?)B?\s+used\s*=\s*([\d.]+)\s*([KMGT]?)B?`)
	m := re.FindStringSubmatch(raw)
	if len(m) != 5 {
		return 0, 0, false
	}
	total = parseSizeWithUnit(m[1], m[2])
	used = parseSizeWithUnit(m[3], m[4])
	if total == 0 {
		return 0, 0, false
	}
	return total, used, true
}

func parseSizeWithUnit(num, unit string) uint64 {
	f, err := strconv.ParseFloat(num, 64)
	if err != nil || f < 0 {
		return 0
	}
	mult := float64(1)
	switch strings.ToUpper(unit) {
	case "K":
		mult = 1024
	case "M":
		mult = 1024 * 1024
	case "G":
		mult = 1024 * 1024 * 1024
	case "T":
		mult = 1024 * 1024 * 1024 * 1024
	}
	return uint64(f * mult)
}
