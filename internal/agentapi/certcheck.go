package agentapi

// CertBrief 证书检查快照里的一张证书（与 /collect/certs 的字段对齐，只留告警要用的）。
type CertBrief struct {
	Name     string   `json:"name"`
	Domains  []string `json:"domains"`
	Issuer   string   `json:"issuer"`
	NotAfter int64    `json:"notAfter"` // 到期时间（Unix 秒）
	DaysLeft int      `json:"daysLeft"` // 扫描当时的剩余天数（负数 = 已过期）
}

// CertCheckSnapshot spanel-agent 每天一次的 /etc/nginx/cert 扫描结果。
// Scanned=false 表示今天还没扫过（例如进程在凌晨 6 点前启动，正在等到点）。
type CertCheckSnapshot struct {
	Scanned   bool   `json:"scanned"`
	LocalDate string `json:"localDate"` // 主机本地日期 YYYY-MM-DD
	ScannedAt int64  `json:"scannedAt"` // Unix 秒
	Installed bool   `json:"installed"` // 目录是否存在
	NoOpenssl bool   `json:"noOpenssl"` // 远程缺少 openssl，无法解析
	// ParseFailed 目录里有非私钥文件没解析成证书。不当成证书已删除。
	ParseFailed bool        `json:"parseFailed"`
	Certs       []CertBrief `json:"certs"`
}
