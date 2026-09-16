package aptsource

import (
	"os"
	"strings"
)

func parseOSRelease(raw string) Distro {
	kv := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		kv[k] = unquote(v)
	}
	id := strings.ToLower(kv["ID"])
	d := Distro{
		ID:       id,
		Name:     kv["NAME"],
		Version:  kv["VERSION_ID"],
		Codename: kv["VERSION_CODENAME"],
		Apt:      id == "ubuntu" || id == "debian",
	}
	if d.Name == "" {
		d.Name = kv["PRETTY_NAME"]
	}
	return d
}

func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && ((s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'')) {
		return s[1 : len(s)-1]
	}
	return s
}

func readDistro() (Distro, error) {
	b, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return Distro{}, err
	}
	return parseOSRelease(string(b)), nil
}
