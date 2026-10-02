//go:build darwin

package localsys

import (
	"os"
	"os/exec"
)

// CollectNginx 采集 Nginx 配置列表。
func CollectNginx() (*NginxInfo, error) {
	return collectNginxInfo(resolveNginxBin(), nginxConfFallbacks(), nginxIsRunning()), nil
}

// resolveNginxBin 定位 nginx 可执行文件。
// macOS 从 Dock/Finder 启动时 PATH 通常不含 Homebrew，exec.LookPath 会失败，
// 因此 LookPath 失败后再探测常见绝对路径。
func resolveNginxBin() string {
	if bin, err := exec.LookPath("nginx"); err == nil {
		return bin
	}
	candidates := []string{
		"/opt/homebrew/bin/nginx",
		"/opt/homebrew/opt/nginx/bin/nginx",
		"/usr/local/bin/nginx",
		"/usr/local/opt/nginx/bin/nginx",
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
		"/opt/homebrew/etc/nginx/nginx.conf",
		"/usr/local/etc/nginx/nginx.conf",
		"/etc/nginx/nginx.conf",
	}
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
	return nginxReadCommon(path)
}

// listNginxFiles macOS：主配置 + include 链 + 常见子目录。
func listNginxFiles(conf string) []NginxFile {
	return collectNginxFiles(conf)
}
