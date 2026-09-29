package localsys

import (
	"net"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/prochide"
)

// detectRuntimes 探测 PATH 中的常见运行时版本（跨平台：macOS / Windows）。
// 概览页会周期轮询，结果缓存 60s，避免每次都 spawn 子进程。
var (
	runtimesMu    sync.Mutex
	runtimesCache []Runtime
	runtimesAt    time.Time
)

const runtimesCacheTTL = 60 * time.Second

func detectRuntimes() []Runtime {
	runtimesMu.Lock()
	defer runtimesMu.Unlock()
	if time.Since(runtimesAt) < runtimesCacheTTL && runtimesCache != nil {
		out := make([]Runtime, len(runtimesCache))
		copy(out, runtimesCache)
		return out
	}
	names := []string{"java", "go", "python3", "node", "bun"}
	var out []Runtime
	for _, name := range names {
		path, err := exec.LookPath(name)
		if err != nil {
			if name == "python3" {
				path, err = exec.LookPath("python")
				if err != nil {
					continue
				}
				name = "python"
			} else {
				continue
			}
		}
		ver := runtimeVersion(name, path)
		display := name
		if display == "python3" {
			display = "python"
		}
		out = append(out, Runtime{Name: display, Version: ver, Path: path})
	}
	runtimesCache = out
	runtimesAt = time.Now()
	return out
}

func runtimeVersion(name, path string) string {
	var cmd *exec.Cmd
	switch name {
	case "java":
		cmd = exec.Command(path, "-version")
	case "go":
		cmd = exec.Command(path, "version")
	case "node", "bun":
		cmd = exec.Command(path, "-v")
	default:
		cmd = exec.Command(path, "--version")
	}
	// Windows GUI 进程下不抑制控制台会弹黑窗闪烁
	prochide.Hide(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil && len(out) == 0 {
		return ""
	}
	line := strings.TrimSpace(strings.Split(string(out), "\n")[0])
	re := regexp.MustCompile(`(\d+\.\d+(?:\.\d+)?)`)
	m := re.FindStringSubmatch(line)
	if len(m) >= 2 {
		return m[1]
	}
	return line
}

// firstNonLoopbackIPv4 返回第一个非环回 IPv4（跨平台回退路径）。
func firstNonLoopbackIPv4() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			ipNet, ok := a.(*net.IPNet)
			if !ok || ipNet.IP.To4() == nil {
				continue
			}
			return ipNet.IP.String()
		}
	}
	return ""
}
