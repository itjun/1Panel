package localsys

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
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
		info.ConfD = filepath.Join(info.ConfDir, "conf.d")
		info.Files = listConfDFiles(info.ConfD)
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

// listConfDFiles 只列给定 conf.d 目录下的用户配置（不递归、跳过隐藏文件）。
// nginx.conf、mime.types、servers/、sites-* 等一律不进列表：自定义配置只允许放 conf.d。
func listConfDFiles(confD string) []NginxFile {
	entries, err := os.ReadDir(confD)
	if err != nil {
		return nil
	}
	var files []NginxFile
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		st, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, NginxFile{
			Name: e.Name(),
			Path: filepath.Join(confD, e.Name()),
			Size: st.Size(),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files
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
