//go:build !windows

package updater

import (
	"net/http"
	"net/url"
)

// proxyFunc 非 Windows 平台只认环境变量：macOS / 桌面 Linux 的系统代理
// 没有注册表式的统一读取接口，浏览器代理配置对 Go 进程不可见。
func proxyFunc() func(*http.Request) (*url.URL, error) {
	return http.ProxyFromEnvironment
}
