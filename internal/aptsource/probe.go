package aptsource

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

const probeTimeout = 5 * time.Second

// ProbeURL 该镜像用于测速的 Release 地址。
func ProbeURL(distro Distro, m Mirror) string {
	host := m.Host
	if distro.ID == "debian" {
		if m.ID == IDOfficial {
			host = "deb.debian.org"
		}
		return "http://" + host + "/debian/dists/" + distro.Codename + "/Release"
	}
	if m.ID == IDOfficial {
		host = "archive.ubuntu.com"
	}
	return "http://" + host + "/ubuntu/dists/" + distro.Codename + "/Release"
}

// ProbeAll 并行测候选镜像。
func ProbeAll(distro Distro) []ProbeHit {
	cands := MirrorsFor(distro.ID)
	out := make([]ProbeHit, len(cands))
	var wg sync.WaitGroup
	for i, m := range cands {
		wg.Add(1)
		go func(i int, m Mirror) {
			defer wg.Done()
			out[i] = probeOne(distro, m)
		}(i, m)
	}
	wg.Wait()
	return out
}

func probeOne(distro Distro, m Mirror) ProbeHit {
	hit := ProbeHit{ID: m.ID, Name: m.Name, Host: m.Host}
	u := ProbeURL(distro, m)
	cli := &http.Client{Timeout: probeTimeout}
	start := time.Now()
	resp, err := cli.Get(u)
	ms := time.Since(start).Milliseconds()
	hit.MS = ms
	if err != nil {
		hit.Error = err.Error()
		return hit
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		hit.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
		return hit
	}
	hit.OK = true
	return hit
}

// Best 返回成功且延迟最低的镜像；都失败则 ok=false。
func Best(hits []ProbeHit) (ProbeHit, bool) {
	var best ProbeHit
	found := false
	for _, h := range hits {
		if !h.OK {
			continue
		}
		if !found || h.MS < best.MS {
			best = h
			found = true
		}
	}
	return best, found
}
