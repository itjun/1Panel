package localsys

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"diteng-pannel/internal/prochide"
)

// Nginx 公共采集逻辑（macOS / Linux；Windows 解压布局差异大，见 nginx_windows.go）。

// collectNginxInfo 由 nginx 可执行文件组装配置概览。
// fallbacks 为平台默认 conf 候选（detectNginxConf 先取 `nginx -V` 的 --conf-path）。
func collectNginxInfo(bin string, fallbacks []string, running bool) *NginxInfo {
	info := &NginxInfo{}
	if bin == "" {
		return info
	}
	info.Installed = true
	verCmd := exec.Command(bin, "-v")
	prochide.Hide(verCmd)
	verOut, _ := verCmd.CombinedOutput()
	info.Version = parseNginxVersion(string(verOut))

	conf := detectNginxConf(bin, fallbacks)
	info.ConfPath = conf
	if conf != "" {
		info.ConfDir = filepath.Dir(conf)
		info.Files = listNginxFiles(conf)
	}
	info.Running = running
	return info
}

func parseNginxVersion(raw string) string {
	// nginx version: nginx/1.27.0
	raw = strings.TrimSpace(raw)
	if i := strings.LastIndex(raw, "/"); i >= 0 {
		return strings.TrimSpace(raw[i+1:])
	}
	return raw
}

func detectNginxConf(bin string, fallbacks []string) string {
	confCmd := exec.Command(bin, "-V")
	prochide.Hide(confCmd)
	out, _ := confCmd.CombinedOutput()
	for _, part := range strings.Fields(string(out)) {
		if v, ok := strings.CutPrefix(part, "--conf-path="); ok {
			if st, err := os.Stat(v); err == nil && !st.IsDir() {
				return v
			}
		}
	}
	for _, c := range fallbacks {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// collectNginxFiles 主配置 + include 链 + 常见子目录（macOS 用；
// Linux 只列 conf.d，见 nginx_linux.go）。
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

// nginxReadCommon 读取配置文件内容；路径必须在 conf 目录内（macOS / Linux）。
func nginxReadCommon(path string) (string, error) {
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
