package monitor

import (
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
			Name:   fields[0],
			Load:   fields[1],
			Active: fields[2],
			Sub:    fields[3],
		})
	}
	return out
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

// CollectPackages 采集 apt 已安装的软件包列表（按需触发，频率低）
func (c *Collector) CollectPackages(host string, opt sshd.ConnectOption) ([]AptPackage, error) {
	out, err := c.mgr.Run(host, opt, "dpkg-query -W -f='${Package}\t${Version}\n'")
	if err != nil {
		return nil, err
	}
	return parsePackages(string(out)), nil
}

func parsePackages(s string) []AptPackage {
	out := []AptPackage{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) != 2 {
			continue
		}
		out = append(out, AptPackage{Name: fields[0], Version: fields[1]})
	}
	return out
}
