package monitor

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"
)

// CertDir 统一证书目录：所有主机的证书（证书 + 私钥）都放在这里
const CertDir = "/etc/nginx/cert"

// CertInfo 单张证书的识别结果（参考 1Panel 证书列表字段）
type CertInfo struct {
	subjectCN  string   // 使用者 CN，仅解析过程内部使用，不序列化
	issuerCN   string   // 颁发者 CN，仅解析过程内部使用，不序列化
	Name       string   `json:"name"`       // 证书文件名
	Domains    []string `json:"domains"`    // CN + SAN 域名（去重）
	Issuer     string   `json:"issuer"`     // 颁发者（CN 优先，回退 O）
	NotAfter   int64    `json:"notAfter"`   // 到期时间（Unix 秒）
	DaysLeft   int      `json:"daysLeft"`   // 剩余天数（负数 = 已过期）
	SelfSigned bool     `json:"selfSigned"` // 颁发者 == 使用者 视为自签名
	HasKey     bool     `json:"hasKey"`     // 同名 .key 是否存在
	KeyName    string   `json:"keyName"`    // 匹配到的私钥文件名
	Size       int64    `json:"size"`       // 证书文件大小（字节）
	Mtime      int64    `json:"mtime"`      // 文件修改时间（Unix 秒）
}

// CertListResult /etc/nginx/cert 的整体识别结果
type CertListResult struct {
	Installed bool       `json:"installed"` // 目录是否存在
	NoOpenssl bool       `json:"noOpenssl"` // 远程缺少 openssl，无法解析证书内容
	Certs     []CertInfo `json:"certs"`
	// UnparsedCerts 不是私钥、但 openssl 没解析出证书的文件数。不进证书页 JSON。
	UnparsedCerts int `json:"-"`
}

// CollectCerts 识别远程主机 /etc/nginx/cert 下的全部证书
// 一次 SSH 脚本完成：目录检测 → 遍历文件 → openssl x509 -text 解析
func (c *Collector) CollectCerts(host string, opt sshd.ConnectOption) (CertListResult, error) {
	// -text 一次性拿到 Subject/Issuer/Not After/SAN，兼容 openssl 1.0 ~ 3.x
	// =FILE= 段是文件元信息；cert=1 时跟一段 =TEXT=（openssl 原始输出）
	script := `D='/etc/nginx/cert'
[ -d "$D" ] || { echo "=NODIR="; exit 0; }
command -v openssl >/dev/null 2>&1 || { echo "=NOSSL="; exit 0; }
for f in "$D"/*; do
  [ -f "$f" ] || continue
  sz=$(stat -c %s "$f" 2>/dev/null || stat -f %z "$f" 2>/dev/null)
  mt=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null)
  echo "=FILE="
  echo "name=$(basename "$f")"
  echo "size=$sz"
  echo "mtime=$mt"
  txt=$(openssl x509 -in "$f" -noout -text 2>/dev/null)
  if [ -n "$txt" ]; then
    echo "cert=1"
    echo "=TEXT="
    printf '%s\n' "$txt"
    echo "=ENDTEXT="
  else
    echo "cert=0"
  fi
done`

	out, err := c.mgr.Run(host, opt, script)
	if err != nil {
		return CertListResult{}, err
	}
	result, _ := parseCertsOutput(string(out), time.Now())
	return result, nil
}

// certExt 取文件扩展名（含点），无扩展名返回空
func certExt(name string) string {
	idx := strings.LastIndex(name, ".")
	if idx <= 0 {
		return ""
	}
	return name[idx:]
}

// parseCertsOutput 解析脚本输出，返回证书结果和目录下全部文件名集合（now 传入便于测试）
func parseCertsOutput(s string, now time.Time) (CertListResult, map[string]bool) {
	allFiles := map[string]bool{}
	if strings.Contains(s, "=NODIR=") {
		return CertListResult{Installed: false}, allFiles
	}
	result := CertListResult{Installed: true}
	if strings.Contains(s, "=NOSSL=") {
		result.NoOpenssl = true
		return result, allFiles
	}

	var cur *CertInfo
	lines := strings.Split(s, "\n")
	inText := false
	flush := func() {
		if cur == nil {
			return
		}
		// NotAfter > 0 说明 openssl 成功解析出了证书；cert=0 的文件（私钥等）不进证书列表
		if cur.NotAfter > 0 {
			// openssl 输出中 Issuer 在 Subject 之前，自签名判定须等两者都解析完
			cur.SelfSigned = cur.issuerCN != "" && cur.issuerCN == cur.subjectCN
			result.Certs = append(result.Certs, *cur)
		}
		if cur.Name != "" {
			allFiles[cur.Name] = true
		}
		cur = nil
	}
	for _, line := range lines {
		l := strings.TrimSpace(line)
		switch l {
		case "=FILE=":
			flush()
			cur = &CertInfo{}
			inText = false
		case "=TEXT=":
			inText = true
		case "=ENDTEXT=":
			inText = false
		}
		if cur == nil || inText {
			if cur != nil && inText {
				cur.parseTextLine(line)
			}
			continue
		}
		switch {
		case strings.HasPrefix(l, "name="):
			cur.Name = strings.TrimPrefix(l, "name=")
		case strings.HasPrefix(l, "size="):
			cur.Size, _ = strconv.ParseInt(strings.TrimPrefix(l, "size="), 10, 64)
		case strings.HasPrefix(l, "mtime="):
			cur.Mtime, _ = strconv.ParseInt(strings.TrimPrefix(l, "mtime="), 10, 64)
		}
	}
	flush()

	sort.Slice(result.Certs, func(i, j int) bool { return result.Certs[i].Name < result.Certs[j].Name })
	// 私钥匹配：按去扩展名的同名 .key 找；fullchain/cert 特例配 privkey.pem
	for i := range result.Certs {
		ci := &result.Certs[i]
		if ci.NotAfter > 0 {
			ci.DaysLeft = int(time.Unix(ci.NotAfter, 0).Sub(now).Hours() / 24)
		}
		stem := strings.TrimSuffix(ci.Name, certExt(ci.Name))
		for _, key := range []string{stem + ".key", "privkey.pem"} {
			if allFiles[key] && (key != "privkey.pem" || stem == "fullchain" || stem == "cert") {
				ci.HasKey = true
				ci.KeyName = key
				break
			}
		}
	}
	parsed := map[string]bool{}
	for _, c := range result.Certs {
		parsed[c.Name] = true
	}
	for name := range allFiles {
		if parsed[name] || certFileIsKey(name) {
			continue
		}
		result.UnparsedCerts++
	}
	return result, allFiles
}

// certFileIsKey 私钥文件。解析失败的证书不能算成私钥，否则会把「解析不出」当成证书已删除。
func certFileIsKey(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return strings.HasSuffix(n, ".key") || n == "privkey.pem"
}

// parseTextLine 从 openssl x509 -text 的输出行中提取证书字段
func (ci *CertInfo) parseTextLine(line string) {
	l := strings.TrimSpace(line)
	switch {
	case strings.HasPrefix(l, "Subject:"):
		ci.subjectCN = dnValue(strings.TrimPrefix(l, "Subject:"), "CN")
		ci.Domains = appendUnique(ci.Domains, ci.subjectCN)
	case strings.HasPrefix(l, "Issuer:"):
		issuer := strings.TrimPrefix(l, "Issuer:")
		ci.issuerCN = dnValue(issuer, "CN")
		ci.Issuer = ci.issuerCN
		if ci.Issuer == "" {
			ci.Issuer = dnValue(issuer, "O")
		}
	case strings.HasPrefix(l, "Not After :"):
		if t, err := time.Parse("Jan 2 15:04:05 2006 MST", strings.TrimSpace(strings.TrimPrefix(l, "Not After :"))); err == nil {
			ci.NotAfter = t.Unix()
		}
	}
	// SAN 行形如 "DNS:example.com, DNS:*.example.com"（可能带 IP Address 等其他条目）
	if strings.Contains(l, "DNS:") {
		re := regexp.MustCompile(`DNS:([^,\s]+)`)
		for _, m := range re.FindAllStringSubmatch(l, -1) {
			ci.Domains = appendUnique(ci.Domains, m[1])
		}
	}
}

// dnValue 从 DN 串中取指定键的值
// 兼容三种 openssl 格式：/C=US/CN=foo（1.0）、C = US, CN = foo（1.1+）、C=US, CN=foo（3.x）
func dnValue(dn, key string) string {
	re := regexp.MustCompile(`(?:^|[/,\s])` + key + `\s*=\s*("[^"]*"|[^,/]+)`)
	m := re.FindStringSubmatch(dn)
	if m == nil {
		return ""
	}
	return strings.Trim(strings.TrimSpace(m[1]), `"`)
}

func appendUnique(list []string, v string) []string {
	if v == "" {
		return list
	}
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}
