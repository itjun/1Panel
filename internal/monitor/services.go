package monitor

import (
	"fmt"
	"strconv"
	"strings"

	"diteng-pannel/internal/sshd"
)

// CollectServices 采集 systemd 运行中的服务列表
// 命令策略：systemctl list-units --type=service --state=running
func (c *Collector) CollectServices(host string, opt sshd.ConnectOption) ([]Service, error) {
	cmd := `systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null`
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	return parseServices(string(out)), nil
}

func parseServices(s string) []Service {
	out := []Service{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		out = append(out, Service{
			Name:        fields[0],
			Load:        fields[1],
			Active:      fields[2],
			Sub:         fields[3],
			Description: strings.Join(fields[4:], " "),
		})
	}
	return out
}

// CollectServiceDetail 按需查询单个服务的详情（悬浮卡片触发，不随列表轮询）
// name 先做白名单校验再拼命令，避免注入
func (c *Collector) CollectServiceDetail(host, name string, opt sshd.ConnectOption) (ServiceDetail, error) {
	if !isValidServiceName(name) {
		return ServiceDetail{}, fmt.Errorf("非法服务名: %s", name)
	}
	cmd := fmt.Sprintf(
		`systemctl show %s --no-pager --property=Id,Description,LoadState,ActiveState,SubState,MainPID,ExecStart,FragmentPath,ActiveEnterTimestamp,MemoryCurrent,CPUTimeNSec,Restart,User 2>/dev/null`,
		name,
	)
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return ServiceDetail{}, err
	}
	return parseServiceDetail(string(out)), nil
}

// isValidServiceName systemd 单元名仅允许字母数字与 . _ @ - 组合
func isValidServiceName(s string) bool {
	if s == "" || len(s) > 200 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '.' || r == '_' || r == '@' || r == '-':
		default:
			return false
		}
	}
	return true
}

func parseServiceDetail(s string) ServiceDetail {
	d := ServiceDetail{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		if line == "" {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch k {
		case "Id":
			d.ID = v
		case "Description":
			d.Description = v
		case "LoadState":
			d.LoadState = v
		case "ActiveState":
			d.ActiveState = v
		case "SubState":
			d.SubState = v
		case "MainPID":
			d.MainPID = v
		case "ExecStart":
			d.ExecStart = v
		case "FragmentPath":
			d.FragmentPath = v
		case "ActiveEnterTimestamp":
			d.ActiveEnterTimestamp = v
		case "MemoryCurrent":
			d.MemoryCurrent = v
		case "CPUTimeNSec":
			d.CPUTimeNSec = v
		case "Restart":
			d.Restart = v
		case "User":
			d.User = v
		}
	}
	return d
}

// CollectCrons 采集定时任务（用户级 + 系统级）
// 命令策略：
//   - crontab -l 当前用户
//   - /etc/crontab 系统主表
//   - /etc/cron.d/* 系统扩展
func (c *Collector) CollectCrons(host string, opt sshd.ConnectOption) ([]Cron, error) {
	cmd := `echo "=USER="; crontab -l 2>/dev/null; echo "=ETC="; cat /etc/crontab 2>/dev/null; echo "=CROND="; cat /etc/cron.d/* 2>/dev/null`
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	return parseCrons(string(out)), nil
}

func parseCrons(s string) []Cron {
	out := []Cron{}
	current := ""
	for _, line := range strings.Split(s, "\n") {
		l := strings.TrimSpace(line)
		if l == "=USER=" || l == "=ETC=" || l == "=CROND=" {
			current = l
			continue
		}
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		// 跳过 /etc/crontab 与 /etc/cron.d/* 里的环境变量定义行
		// 形如 SHELL=/bin/sh、PATH=/usr/local/sbin:...、RANDOM_DELAY=...
		if isCronEnvLine(l) {
			continue
		}
		source := ""
		user := ""
		switch current {
		case "=USER=":
			source = "user"
		case "=ETC=":
			source = "etc-crontab"
		case "=CROND=":
			source = "etc-cron.d"
		}
		// /etc/crontab 与 /etc/cron.d/* 多一个 user 字段
		if source == "etc-crontab" || source == "etc-cron.d" {
			fields := strings.Fields(l)
			if len(fields) >= 7 {
				user = fields[5]
			}
		}
		out = append(out, Cron{User: user, Line: l, Source: source})
	}
	return out
}

// isCronEnvLine 判断一行是否是 cron 的环境变量定义（而非调度任务）
// 形如 KEY=VALUE 或 KEY = VALUE
func isCronEnvLine(l string) bool {
	// 必须包含 =
	idx := strings.Index(l, "=")
	if idx <= 0 {
		return false
	}
	key := strings.TrimSpace(l[:idx])
	// key 必须全是大写字母/下划线/数字，且以字母开头
	if key[0] < 'A' || key[0] > 'Z' {
		return false
	}
	for _, c := range key {
		if !(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9') && c != '_' {
			return false
		}
	}
	return true
}

// CollectPackages 采集 apt 已安装的软件包列表 + 依赖数
// 用 dpkg-query 一次性拿 Package / Version / Depends 三个字段（避免每个包单独跑 apt-cache）
// Depends 字段是一行用逗号分隔的依赖列表，我们解析后统计个数
func (c *Collector) CollectPackages(host string, opt sshd.ConnectOption) ([]AptPackage, error) {
	// 用 \x1f (US) 作为字段分隔符，避免 Depends 中的逗号/空格干扰
	// Depends 字段长这样："libc6 (>= 2.34), libssl3 (>= 3.0.0), zlib1g"
	cmd := "dpkg-query -W -f='${Package}\t${Version}\t${Depends}\n'"
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	return parsePackages(string(out)), nil
}

// CollectPackageDepends 查询单个已安装包的直接依赖名（dpkg Depends）
func (c *Collector) CollectPackageDepends(host string, opt sshd.ConnectOption, pkgName string) ([]string, error) {
	name := strings.TrimSpace(pkgName)
	if name == "" {
		return nil, fmt.Errorf("包名不能为空")
	}
	if !isValidDebPackageName(name) {
		return nil, fmt.Errorf("非法包名: %s", name)
	}
	cmd := "dpkg-query -W -f='${Depends}' " + strconv.Quote(name)
	out, err := c.mgr.Run(host, opt, cmd)
	if err != nil {
		return nil, err
	}
	return parseDepends(strings.TrimSpace(string(out))), nil
}

func isValidDebPackageName(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '+' || r == '-' || r == '.' {
			continue
		}
		return false
	}
	return true
}

// parsePackages 解析 dpkg-query 输出
// 字段顺序：Package \t Version \t Depends
// Depends 字段可能为空（无依赖），或形如 "libc6 (>= 2.34), libssl3, zlib1g"
func parsePackages(s string) []AptPackage {
	out := []AptPackage{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		if line == "" {
			continue
		}
		// 注意：dpkg-query 用单引号包裹，输出仍是 \t 分隔
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}
		pkg := AptPackage{
			Name:    fields[0],
			Version: fields[1],
		}
		if len(fields) >= 3 {
			pkg.DepList = parseDepends(fields[2])
			pkg.Depends = len(pkg.DepList)
		}
		out = append(out, pkg)
	}
	return out
}

// parseDepends 解析 Depends 字段，返回直接依赖包名列表（保持 dpkg 顺序）
// Depends 字段示例：
//   "libc6 (>= 2.34), libssl3 (>= 3.0.0), zlib1g"
//   "libpython3.10 (>= 3.10), libpython3.10:amd64 | libpython3.11"
// 解析规则：按逗号分隔；or 选择（|）取左侧项；去掉版本约束与架构后缀
func parseDepends(depends string) []string {
	if depends == "" {
		return nil
	}
	names := []string{}
	for _, item := range strings.Split(depends, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if idx := strings.Index(item, "|"); idx >= 0 {
			item = strings.TrimSpace(item[:idx])
		}
		if idx := strings.Index(item, "("); idx >= 0 {
			item = strings.TrimSpace(item[:idx])
		}
		if idx := strings.Index(item, ":"); idx >= 0 {
			item = strings.TrimSpace(item[:idx])
		}
		if item != "" {
			names = append(names, item)
		}
	}
	return names
}
