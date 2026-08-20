package monitor

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"
)

// dockerStatsCacheTTL 容器 stats 缓存：docker stats --no-stream 需等一个完整
// 采样周期（秒级），Docker 页 5s 轮询没必要每次真采；容器列表（启停）保持实时
const (
	dockerStatsCacheTTL   = 15 * time.Second
	dockerStatsRetryDelay = 5 * time.Second
)

// CollectDocker 一次采集 Docker 容器列表 + 资源占用统计
// 命令策略（Debian/Ubuntu）：
//   - docker ps 用 --format '{{json .}}' 输出每行一个 JSON
//   - docker stats --no-stream 用 --format '{{json .}}' 同样每行一个 JSON（15s 缓存）
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

	info.Stats = parseContainerStats(c.dockerStatsCached(host, opt))
	return info, nil
}

// dockerStatsCached 容器资源采样（惰性缓存 dockerStatsCacheTTL）。
// 采样失败保留旧值不清空（daemon 重启等瞬时抖动），短退避后重试。
func (c *Collector) dockerStatsCached(host string, opt sshd.ConnectOption) string {
	c.dockerStatsMu.Lock()
	defer c.dockerStatsMu.Unlock()
	if time.Now().Before(c.dockerStatsNext) {
		return c.dockerStatsOut
	}
	out, _ := c.mgr.Run(host, opt, `docker stats --no-stream --format '{{json .}}' 2>/dev/null`,
		sshd.RunOptions{Timeout: 20 * time.Second})
	c.dockerStatsOut = string(out)
	if len(out) == 0 {
		c.dockerStatsNext = time.Now().Add(dockerStatsRetryDelay)
	} else {
		c.dockerStatsNext = time.Now().Add(dockerStatsCacheTTL)
	}
	return c.dockerStatsOut
}

// CollectDockerInspect 按需查询单个容器的 docker inspect 原始 JSON（悬浮卡片触发，不随列表轮询）
// container 允许容器名或 ID；先做白名单校验再拼命令，避免注入
func (c *Collector) CollectDockerInspect(host, container string, opt sshd.ConnectOption) (string, error) {
	if !isValidContainerRef(container) {
		return "", fmt.Errorf("非法容器名: %s", container)
	}
	cmd := fmt.Sprintf("docker inspect '%s' 2>&1", container)
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return "", err
	}
	s := strings.TrimSpace(string(out))
	// 校验输出确实是 JSON 数组（"No such object" 之类的报错文本直接返回错误）
	if !strings.HasPrefix(s, "[") || !json.Valid([]byte(s)) {
		return "", fmt.Errorf("docker inspect 失败: %s", firstLine(s))
	}
	return s, nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// isValidContainerRef 容器名/ID 仅允许字母数字与 . _ - 组合（docker 命名规范）
func isValidContainerRef(s string) bool {
	if s == "" || len(s) > 200 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
			c == '.' || c == '_' || c == '-') {
			return false
		}
	}
	return true
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
