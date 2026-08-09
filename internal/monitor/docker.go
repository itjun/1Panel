package monitor

import (
	"encoding/json"
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// CollectDocker 一次采集 Docker 容器列表 + 资源占用统计
// 命令策略（Debian/Ubuntu）：
//   - docker ps 用 --format '{{json .}}' 输出每行一个 JSON
//   - docker stats --no-stream 用 --format '{{json .}}' 同样每行一个 JSON
//   - 若命令不存在或无权限，返回 Available=false
func (c *Collector) CollectDocker(host string, opt sshd.ConnectOption) (DockerInfo, error) {
	info := DockerInfo{Available: false}
	listCmd := `docker ps -a --format '{{json .}}' 2>/dev/null`
	out, err := c.mgr.Run(host, opt, listCmd)
	if err != nil {
		return info, err
	}
	if strings.Contains(string(out), "Cannot connect to the Docker daemon") {
		return info, nil
	}
	info.Available = true
	info.Containers = parseContainerList(string(out))

	statsCmd := `docker stats --no-stream --format '{{json .}}' 2>/dev/null`
	statsOut, _ := c.mgr.Run(host, opt, statsCmd)
	info.Stats = parseContainerStats(string(statsOut))
	return info, nil
}

func parseContainerList(s string) []Container {
	out := []Container{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var m map[string]string
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			continue
		}
		out = append(out, Container{
			ID:     m["ID"],
			Name:   m["Names"],
			Image:  m["Image"],
			Status: m["Status"],
			State:  m["State"],
			Ports:  m["Ports"],
		})
	}
	return out
}

func parseContainerStats(s string) []ContainerStat {
	out := []ContainerStat{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var m map[string]string
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			continue
		}
		out = append(out, ContainerStat{
			Name:       m["Name"],
			CPUPercent: parseCPUPercent(m["CPUPerc"]),
			MemUsage:   parseBytesPair(m["MemUsage"]).Used,
			MemLimit:   parseBytesPair(m["MemUsage"]).Total,
			MemPercent: parsePercent(m["MemPerc"]),
			NetIn:      parseBytesPair(m["NetIO"]).Used,
			NetOut:     parseBytesPair(m["NetIO"]).Total,
			BlockIn:    parseBytesPair(m["BlockIO"]).Used,
			BlockOut:   parseBytesPair(m["BlockIO"]).Total,
		})
	}
	return out
}

// parseCPUPercent "12.34%" → 12.34
func parseCPUPercent(s string) float64 {
	return parsePercent(s)
}

func parsePercent(s string) float64 {
	s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), "%"))
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

type pair struct {
	Used, Total uint64
}

// parseBytesPair "120MiB / 1GiB" → {Used: 120*1024^2, Total: 1*1024^3}
// docker stats 的输出单位是: B / KiB / MiB / GiB / TiB
func parseBytesPair(s string) pair {
	parts := strings.Split(s, "/")
	if len(parts) != 2 {
		return pair{}
	}
	return pair{Used: parseHumanBytes(parts[0]), Total: parseHumanBytes(parts[1])}
}

func parseHumanBytes(s string) uint64 {
	s = strings.TrimSpace(s)
	if s == "--" || s == "" {
		return 0
	}
	// 数字 + 单位
	idx := len(s)
	for i, c := range s {
		if c < '0' || c > '9' {
			if c != '.' {
				idx = i
				break
			}
		}
	}
	numStr := strings.TrimSpace(s[:idx])
	unit := strings.TrimSpace(s[idx:])
	num, _ := strconv.ParseFloat(numStr, 64)
	mult := uint64(1)
	switch unit {
	case "B":
		mult = 1
	case "kB", "KB":
		mult = 1000
	case "KiB":
		mult = 1024
	case "MB":
		mult = 1000 * 1000
	case "MiB":
		mult = 1024 * 1024
	case "GB":
		mult = 1000 * 1000 * 1000
	case "GiB":
		mult = 1024 * 1024 * 1024
	case "TB":
		mult = 1000 * 1000 * 1000 * 1000
	case "TiB":
		mult = 1024 * 1024 * 1024 * 1024
	}
	return uint64(num * float64(mult))
}
