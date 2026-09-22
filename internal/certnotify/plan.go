package certnotify

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/agentapi"
)

// AlertBelowDays 剩余天数小于该值才催（整数 daysLeft，与证书页「≤30 天变色」不是同一条线）。
const AlertBelowDays = 30

// Notice 一条待发通知。Title 和 Body 三路频道原样使用。
type Notice struct {
	DomainKey string `json:"domainKey"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Expired   bool   `json:"expired"`
}

// Result 一次扫描相对「上次还在催的域名」的差额。
type Result struct {
	Nags        []Notice `json:"nags"`
	Recoveries  []Notice `json:"recoveries"`
	NextNagging []string `json:"nextNagging"`
}

type certGroup struct {
	key       string
	domainKey string
	domains   []string
	names     []string
	notAfter  int64
	daysLeft  int
}

// Plan 根据本次扫描和上次还在催的域名，算出今天要发的催办、恢复，以及催完后仍在窗口里的域名。
// 分组钥匙与证书页一致：域名（原顺序）+ 颁发者 + 到期时间。
// 恢复只看域名：这批域名下已经没有剩余 < 30 天的组，并且有一张剩余 ≥ 30 天的证，才发一条。
// 文件直接消失、没有接上新证：不发恢复。
// openssl 缺失，或有非私钥文件解析不出证书：不发恢复，也不把正在催的域名清掉。
func Plan(host string, snap agentapi.CertCheckSnapshot, nagging []string, loc *time.Location) Result {
	prev := uniqueStrings(nagging)
	if snap.NoOpenssl {
		return holdNagging(prev)
	}
	if loc == nil {
		loc = time.Local
	}
	groups := groupCerts(snap.Certs)
	alertingDomains := map[string]bool{}
	var alerting []certGroup
	healthy := map[string]certGroup{}
	for _, g := range groups {
		if g.daysLeft < AlertBelowDays {
			alerting = append(alerting, g)
			alertingDomains[g.domainKey] = true
			continue
		}
		old, ok := healthy[g.domainKey]
		if !ok || g.notAfter > old.notAfter {
			healthy[g.domainKey] = g
		}
	}
	sort.Slice(alerting, func(i, j int) bool { return alerting[i].key < alerting[j].key })

	nags := make([]Notice, 0, len(alerting))
	nextSet := map[string]bool{}
	for _, g := range alerting {
		nextSet[g.domainKey] = true
		nags = append(nags, nagNotice(host, g, loc))
	}

	recoveries := make([]Notice, 0)
	for _, domainKey := range prev {
		if alertingDomains[domainKey] {
			continue
		}
		g, ok := healthy[domainKey]
		if !ok {
			continue
		}
		recoveries = append(recoveries, recoveryNotice(host, g, loc))
	}
	sort.Slice(recoveries, func(i, j int) bool { return recoveries[i].DomainKey < recoveries[j].DomainKey })

	next := make([]string, 0, len(nextSet))
	for k := range nextSet {
		next = append(next, k)
	}
	sort.Strings(next)
	out := Result{Nags: nags, Recoveries: recoveries, NextNagging: next}
	if snap.ParseFailed {
		out.Recoveries = []Notice{}
		out.NextNagging = uniqueStrings(append(append([]string{}, prev...), next...))
		sort.Strings(out.NextNagging)
	}
	return out
}

func holdNagging(prev []string) Result {
	return Result{
		Nags:        []Notice{},
		Recoveries:  []Notice{},
		NextNagging: prev,
	}
}

// GroupKey 与证书页 certGroupKey 同一格式：域名原顺序、颁发者、到期 unix 秒。
func GroupKey(domains []string, issuer string, notAfter int64) string {
	return strings.Join(domains, ",") + "|" + issuer + "|" + strconv.FormatInt(notAfter, 10)
}

func groupCerts(certs []agentapi.CertBrief) []certGroup {
	order := make([]string, 0)
	byKey := map[string]*certGroup{}
	for _, c := range certs {
		if c.NotAfter <= 0 {
			continue
		}
		domains := append([]string{}, c.Domains...)
		key := GroupKey(domains, c.Issuer, c.NotAfter)
		g := byKey[key]
		if g == nil {
			g = &certGroup{
				key:       key,
				domainKey: strings.Join(domains, ","),
				domains:   domains,
				notAfter:  c.NotAfter,
				daysLeft:  c.DaysLeft,
			}
			byKey[key] = g
			order = append(order, key)
		} else if c.DaysLeft < g.daysLeft {
			g.daysLeft = c.DaysLeft
		}
		if name := strings.TrimSpace(c.Name); name != "" {
			g.names = append(g.names, name)
		}
	}
	out := make([]certGroup, 0, len(order))
	for _, key := range order {
		g := *byKey[key]
		g.names = uniqueStrings(g.names)
		sort.Strings(g.names)
		out = append(out, g)
	}
	return out
}

func nagNotice(host string, g certGroup, loc *time.Location) Notice {
	subject := subjectLabel(g.domains, g.names)
	var suffix, days string
	if g.daysLeft < 0 {
		n := -g.daysLeft
		suffix = fmt.Sprintf("%s 证书已过期 %d 天", subject, n)
		days = fmt.Sprintf("已过期 %d 天", n)
	} else {
		suffix = fmt.Sprintf("%s 证书剩余 %d 天", subject, g.daysLeft)
		days = fmt.Sprintf("剩余 %d 天", g.daysLeft)
	}
	return Notice{
		DomainKey: g.domainKey,
		Title:     hostPrefix(host) + suffix,
		Body:      noticeBody(host, g, loc, days),
		Expired:   g.daysLeft < 0,
	}
}

func recoveryNotice(host string, g certGroup, loc *time.Location) Notice {
	subject := subjectLabel(g.domains, g.names)
	suffix := subject + " 证书已续期"
	days := fmt.Sprintf("剩余 %d 天", g.daysLeft)
	return Notice{
		DomainKey: g.domainKey,
		Title:     hostPrefix(host) + suffix,
		Body:      noticeBody(host, g, loc, days),
	}
}

func noticeBody(host string, g certGroup, loc *time.Location, days string) string {
	expiry := time.Unix(g.notAfter, 0).In(loc).Format("2006-01-02 15:04")
	parts := make([]string, 0, 5)
	if h := strings.TrimSpace(host); h != "" {
		parts = append(parts, h)
	}
	parts = append(parts, subjectLabel(g.domains, g.names), "到期 "+expiry, days)
	if len(g.names) > 0 {
		parts = append(parts, strings.Join(g.names, "、"))
	}
	return strings.Join(parts, " · ")
}

func subjectLabel(domains, names []string) string {
	if len(domains) > 0 {
		return strings.Join(domains, "、")
	}
	if len(names) > 0 {
		return strings.Join(names, "、")
	}
	return "证书"
}

func hostPrefix(host string) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	return "「" + host + "」"
}

func uniqueStrings(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		// 空字符串是「没有域名」这组的钥匙，要留着，否则这组续期后发不出恢复。
		if seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}
