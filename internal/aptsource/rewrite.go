package aptsource

import (
	"net/url"
	"strings"
)

// RewriteContent 把文件里已知归档 URI 换成 target。format 由路径决定：.sources → DEB822。
func RewriteContent(content, distroID, path string, target Mirror) string {
	if strings.HasSuffix(strings.ToLower(path), ".sources") {
		return rewriteDeb822(content, distroID, target)
	}
	return rewriteClassic(content, distroID, target)
}

func rewriteClassic(content, distroID string, target Mirror) string {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		lines[i] = rewriteClassicLine(line, distroID, target)
	}
	return strings.Join(lines, "\n")
}

func rewriteClassicLine(line, distroID string, target Mirror) string {
	trim := strings.TrimSpace(line)
	body := trim
	if strings.HasPrefix(body, "#") {
		body = strings.TrimSpace(strings.TrimPrefix(body, "#"))
	}
	if !strings.HasPrefix(body, "deb") {
		return line
	}
	fields := strings.Fields(line)
	for i, f := range fields {
		raw := strings.TrimPrefix(f, "#")
		if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
			continue
		}
		suites := ""
		if i+1 < len(fields) {
			suites = fields[i+1]
		}
		nu := rewriteURI(raw, distroID, target, suites)
		if nu == raw {
			return line
		}
		if strings.HasPrefix(f, "#") && !strings.HasPrefix(nu, "#") {
			// 行首 # 与 URI 粘在一起的极端情况极少，按字段替换即可
		}
		fields[i] = strings.Replace(f, raw, nu, 1)
		return strings.Join(fields, " ")
	}
	return line
}

func rewriteDeb822(content, distroID string, target Mirror) string {
	stanzas := strings.Split(content, "\n\n")
	for i, st := range stanzas {
		stanzas[i] = rewriteDeb822Stanza(st, distroID, target)
	}
	return strings.Join(stanzas, "\n\n")
}

func rewriteDeb822Stanza(st, distroID string, target Mirror) string {
	lines := strings.Split(st, "\n")
	suites := ""
	for _, line := range lines {
		k, v, ok := cutField(line)
		if ok && strings.EqualFold(k, "Suites") {
			suites = v
		}
	}
	for i, line := range lines {
		k, v, ok := cutField(line)
		if !ok || !strings.EqualFold(k, "URIs") {
			continue
		}
		parts := strings.Fields(v)
		for j, p := range parts {
			parts[j] = rewriteURI(p, distroID, target, suites)
		}
		indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
		colon := strings.Index(line, ":")
		if colon < 0 {
			continue
		}
		key := strings.TrimLeft(line[:colon+1], " \t")
		lines[i] = indent + key + " " + strings.Join(parts, " ")
	}
	return strings.Join(lines, "\n")
}

func cutField(line string) (key, val string, ok bool) {
	s := strings.TrimSpace(line)
	if s == "" || strings.HasPrefix(s, "#") {
		return "", "", false
	}
	i := strings.IndexByte(s, ':')
	if i <= 0 {
		return "", "", false
	}
	return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+1:]), true
}

func rewriteURI(raw, distroID string, target Mirror, suitesHint string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return raw
	}
	if !isArchiveHost(u.Host) {
		return raw
	}
	kind := classifyArchive(u, suitesHint)
	nu, _ := url.Parse(raw)
	nu.Scheme = "http"
	switch distroID {
	case "debian":
		if target.ID == IDOfficial {
			if kind == kindSecurity {
				nu.Host = "security.debian.org"
				nu.Path = "/debian-security"
			} else {
				nu.Host = "deb.debian.org"
				nu.Path = "/debian"
			}
		} else {
			nu.Host = target.Host
			if kind == kindSecurity {
				nu.Path = "/debian-security"
			} else {
				nu.Path = "/debian"
			}
		}
	default:
		if target.ID == IDOfficial {
			if kind == kindPorts {
				nu.Host = "ports.ubuntu.com"
				nu.Path = "/ubuntu-ports"
			} else if kind == kindSecurity {
				nu.Host = "security.ubuntu.com"
				nu.Path = "/ubuntu"
			} else {
				nu.Host = "archive.ubuntu.com"
				nu.Path = "/ubuntu"
			}
		} else {
			nu.Host = target.Host
			if kind == kindPorts {
				nu.Path = "/ubuntu-ports"
			} else {
				nu.Path = "/ubuntu"
			}
		}
	}
	out := nu.String()
	return strings.TrimSuffix(out, "/")
}

type archiveKind int

const (
	kindArchive archiveKind = iota
	kindSecurity
	kindPorts
)

func classifyArchive(u *url.URL, suitesHint string) archiveKind {
	host := u.Host
	path := u.Path
	if strings.Contains(host, "ports.ubuntu") || strings.Contains(path, "ubuntu-ports") {
		return kindPorts
	}
	if strings.Contains(host, "security") ||
		strings.Contains(path, "debian-security") ||
		strings.Contains(suitesHint, "-security") ||
		hasSecuritySuite(suitesHint) {
		return kindSecurity
	}
	return kindArchive
}

func hasSecuritySuite(s string) bool {
	for _, p := range strings.Fields(s) {
		if p == "security" || strings.HasSuffix(p, "-security") {
			return true
		}
	}
	return false
}
