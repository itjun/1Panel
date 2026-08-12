package monitor

import (
	"strings"

	"diteng-pannel/internal/sshd"
)

// CollectDatabases 检测远程主机上已安装的数据库（MySQL/Redis/PostgreSQL/MongoDB）
// 一次 SSH 组合命令，只返回检测到的数据库
func (c *Collector) CollectDatabases(host string, opt sshd.ConnectOption) ([]DatabaseInfo, error) {
	// 每种数据库一段 =SECTION=，输出 4 行：installed/version/active/port
	// installed: command -v 检测命令是否存在
	// version: xxx --version 的输出
	// active: systemctl is-active（兼容多个服务名），非 active 输出空
	// port: ss 监听端口（覆盖 Docker 容器运行的数据库）
	script := `echo "=MYSQL="; if command -v mysql >/dev/null 2>&1; then echo "1"; mysql --version 2>/dev/null | head -1; else echo "0"; echo ""; fi; systemctl is-active mysql mysqld mariadb 2>/dev/null | grep -x active | head -1; ss -tlnp 2>/dev/null | grep -oE ':\*?:3306\b|:3306\b' | grep -oE '3306' | head -1; echo "=REDIS="; if command -v redis-server >/dev/null 2>&1; then echo "1"; redis-server --version 2>/dev/null | head -1; else echo "0"; echo ""; fi; systemctl is-active redis redis-server 2>/dev/null | grep -x active | head -1; ss -tlnp 2>/dev/null | grep -oE ':\*?:6379\b|:6379\b' | grep -oE '6379' | head -1; echo "=POSTGRESQL="; if command -v psql >/dev/null 2>&1; then echo "1"; psql --version 2>/dev/null | head -1; else echo "0"; echo ""; fi; systemctl is-active postgresql 2>/dev/null | grep -x active | head -1; ss -tlnp 2>/dev/null | grep -oE ':\*?:5432\b|:5432\b' | grep -oE '5432' | head -1; echo "=MONGODB="; if command -v mongod >/dev/null 2>&1; then echo "1"; mongod --version 2>/dev/null | head -1; else echo "0"; echo ""; fi; systemctl is-active mongod mongodb 2>/dev/null | grep -x active | head -1; ss -tlnp 2>/dev/null | grep -oE ':\*?:27017\b|:27017\b' | grep -oE '27017' | head -1`

	out, err := c.mgr.Run(host, opt, script)
	if err != nil {
		return nil, err
	}
	return parseDatabases(string(out)), nil
}

// dbDefs section 标记 → 展示名（有序，保证输出顺序稳定）
var dbDefs = []struct{ section, display string }{
	{"MYSQL", "MySQL"},
	{"REDIS", "Redis"},
	{"POSTGRESQL", "PostgreSQL"},
	{"MONGODB", "MongoDB"},
}

func parseDatabases(s string) []DatabaseInfo {
	sections := splitSections(s)
	var result []DatabaseInfo
	for _, d := range dbDefs {
		sec := sections[d.section]
		if sec == "" {
			continue
		}
		lines := strings.Split(sec, "\n")
		installed := len(lines) > 0 && strings.TrimSpace(lines[0]) == "1"
		version := ""
		if len(lines) > 1 {
			version = strings.TrimSpace(lines[1])
		}
		active := ""
		if len(lines) > 2 {
			active = strings.TrimSpace(lines[2])
		}
		port := ""
		if len(lines) > 3 {
			port = strings.TrimSpace(lines[3])
		}
		// 只返回检测到的：命令存在 OR 端口监听 OR 服务 active
		if !installed && port == "" && active == "" {
			continue
		}
		// running = 服务 active OR 端口被监听（Docker 中的库 systemctl 查不到但端口在）
		running := active == "active" || port != ""
		result = append(result, DatabaseInfo{
			Name:    d.display,
			Version: version,
			Running: running,
			Port:    port,
		})
	}
	return result
}
