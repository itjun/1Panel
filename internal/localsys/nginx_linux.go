//go:build linux

package localsys

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// CollectNginx 采集 Nginx 配置列表。
func CollectNginx() (*NginxInfo, error) {
	return collectNginxInfo(resolveNginxBin(), nginxConfFallbacks(), nginxIsRunning()), nil
}

// resolveNginxBin 定位 nginx 可执行文件。
// 发行版 nginx 常装在 /usr/sbin（桌面会话 PATH 不一定包含），LookPath 失败后探测常见路径。
func resolveNginxBin() string {
	if bin, err := exec.LookPath("nginx"); err == nil {
		return bin
	}
	candidates := []string{
		"/usr/sbin/nginx",
		"/usr/local/sbin/nginx",
		"/usr/local/nginx/sbin/nginx",
		"/opt/nginx/sbin/nginx",
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func nginxConfFallbacks() []string {
	return []string{
		"/etc/nginx/nginx.conf",
		"/usr/local/nginx/conf/nginx.conf",
		"/usr/local/etc/nginx/nginx.conf",
	}
}

// nginxIsRunning Linux：systemd 下 master 进程名是 "nginx: master process"。
func nginxIsRunning() bool {
	if err := exec.Command("pgrep", "-x", "nginx").Run(); err == nil {
		return true
	}
	if err := exec.Command("pgrep", "-f", "nginx: master").Run(); err == nil {
		return true
	}
	return false
}

// NginxRead 读取配置文件内容；路径必须在 conf 目录内。
func NginxRead(path string) (string, error) {
	return nginxReadCommon(path)
}

// listNginxFiles Linux：只列 conf 目录下 conf.d/ 里的用户配置
// （nginx.conf 自身、mime.types、modules-enabled 模块片段等系统文件不进列表）。
func listNginxFiles(conf string) []NginxFile {
	dir := filepath.Join(filepath.Dir(conf), "conf.d")
	entries, err := os.ReadDir(dir)
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
			Path: filepath.Join(dir, e.Name()),
			Size: st.Size(),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files
}
