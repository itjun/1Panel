//go:build darwin

package localsys

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// CollectNginx 采集 Nginx 配置列表。
func CollectNginx() (*NginxInfo, error) {
	info := &NginxInfo{}
	bin, err := exec.LookPath("nginx")
	if err != nil {
		return info, nil
	}
	info.Installed = true
	verOut, _ := exec.Command(bin, "-v").CombinedOutput()
	info.Version = parseNginxVersion(string(verOut))

	conf := detectNginxConf(bin)
	info.ConfPath = conf
	if conf != "" {
		info.ConfDir = filepath.Dir(conf)
	}
	if conf != "" {
		files := collectNginxFiles(conf)
		info.Files = files
	}
	if nginxIsRunning() {
		info.Running = true
	}
	return info, nil
}

// nginxIsRunning macOS 上进程名是 "nginx: master process"，pgrep -x nginx 会漏检。
func nginxIsRunning() bool {
	if err := exec.Command("pgrep", "-f", "nginx: master").Run(); err == nil {
		return true
	}
	// 兜底：任意 nginx 进程（worker / 其它启动方式）
	if err := exec.Command("pgrep", "nginx").Run(); err == nil {
		return true
	}
	return false
}

// NginxRead 读取配置文件内容；路径必须在 conf 目录内。
func NginxRead(path string) (string, error) {
	info, err := CollectNginx()
	if err != nil {
		return "", err
	}
	if info.ConfDir == "" {
		return "", os.ErrNotExist
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	root, err := filepath.Abs(info.ConfDir)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", os.ErrPermission
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func parseNginxVersion(raw string) string {
	// nginx version: nginx/1.27.0
	raw = strings.TrimSpace(raw)
	if i := strings.LastIndex(raw, "/"); i >= 0 {
		return strings.TrimSpace(raw[i+1:])
	}
	return raw
}

func detectNginxConf(bin string) string {
	out, _ := exec.Command(bin, "-V").CombinedOutput()
	for _, part := range strings.Fields(string(out)) {
		if v, ok := strings.CutPrefix(part, "--conf-path="); ok {
			if st, err := os.Stat(v); err == nil && !st.IsDir() {
				return v
			}
		}
	}
	candidates := []string{
		"/opt/homebrew/etc/nginx/nginx.conf",
		"/usr/local/etc/nginx/nginx.conf",
		"/etc/nginx/nginx.conf",
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func collectNginxFiles(mainConf string) []NginxFile {
	dir := filepath.Dir(mainConf)
	seen := map[string]bool{}
	var files []NginxFile
	add := func(path string) {
		abs, err := filepath.Abs(path)
		if err != nil {
			return
		}
		if seen[abs] {
			return
		}
		st, err := os.Stat(abs)
		if err != nil || st.IsDir() {
			return
		}
		seen[abs] = true
		files = append(files, NginxFile{
			Name: filepath.Base(abs),
			Path: abs,
			Size: st.Size(),
		})
	}
	add(mainConf)
	walkIncludes(mainConf, dir, add, 0)
	// 常见子目录兜底
	for _, sub := range []string{"conf.d", "servers", "sites-enabled", "sites-available"} {
		entries, err := os.ReadDir(filepath.Join(dir, sub))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if strings.HasSuffix(e.Name(), ".conf") || !strings.Contains(e.Name(), ".") {
				add(filepath.Join(dir, sub, e.Name()))
			}
		}
	}
	return files
}

func walkIncludes(confPath, root string, add func(string), depth int) {
	if depth > 8 {
		return
	}
	b, err := os.ReadFile(confPath)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(b), "\n") {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		fields := strings.Fields(trim)
		if len(fields) < 2 || fields[0] != "include" {
			continue
		}
		pat := strings.TrimSuffix(fields[1], ";")
		if !filepath.IsAbs(pat) {
			pat = filepath.Join(filepath.Dir(confPath), pat)
		}
		matches, err := filepath.Glob(pat)
		if err != nil {
			continue
		}
		for _, m := range matches {
			add(m)
			walkIncludes(m, root, add, depth+1)
		}
	}
}
