//go:build windows

package updater

import "testing"

func TestPickProxyServer(t *testing.T) {
	cases := []struct {
		server string
		scheme string
		want   string
	}{
		{"", "https", ""},
		{"   ", "https", ""},
		{"127.0.0.1:7890", "https", "127.0.0.1:7890"},
		{"127.0.0.1:7890", "http", "127.0.0.1:7890"},
		{"http=127.0.0.1:7890;https=127.0.0.1:7891", "https", "127.0.0.1:7891"},
		{"http=127.0.0.1:7890;https=127.0.0.1:7891", "http", "127.0.0.1:7890"},
		// https 未配置时回退 http，再回退 socks
		{"http=127.0.0.1:7890;socks=127.0.0.1:7892", "https", "127.0.0.1:7890"},
		{"ftp=1.1.1.1:1;socks=127.0.0.1:7892", "https", "127.0.0.1:7892"},
		{"https = 127.0.0.1:7891", "https", "127.0.0.1:7891"},
		// 已带 scheme 的直接原样返回
		{"http://proxy.local:8080", "https", "http://proxy.local:8080"},
	}
	for _, c := range cases {
		if got := pickProxyServer(c.server, c.scheme); got != c.want {
			t.Errorf("pickProxyServer(%q, %s) = %q；期望 %q", c.server, c.scheme, got, c.want)
		}
	}
}

func TestProxyBypass(t *testing.T) {
	cases := []struct {
		host     string
		override string
		want     bool
	}{
		{"github.com", "", false},
		{"github.com", "<local>", false},
		{"build-server", "<local>", true},
		{"BUILD-SERVER", "<local>", true},
		{"corp.com", "corp.com", true},
		{"a.corp.com", "*.corp.com", true},
		{"acorp.com", "*.corp.com", false},
		{"a.b.corp.com", "corp.com", true},
		// Windows 代理客户端常用的网段 / 前缀写法
		{"192.168.5.3", "192.168.*", true},
		{"192.169.5.3", "192.168.*", false},
		{"127.0.0.1", "127.*", true},
		{"localhost", "localhost;192.168.*", true},
		{"other.com", "corp.com;<local>", false},
		{"github.com", "github.com;<local>", true},
	}
	for _, c := range cases {
		if got := proxyBypass(c.host, c.override); got != c.want {
			t.Errorf("proxyBypass(%q, %q) = %v；期望 %v", c.host, c.override, got, c.want)
		}
	}
}
