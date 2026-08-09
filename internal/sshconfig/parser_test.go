package sshconfig

import "testing"

func TestIsGitHost(t *testing.T) {
	cases := []struct {
		name string
		h    HostConfig
		want bool
	}{
		{"github by user", HostConfig{Name: "github.com", User: "git", HostName: "ssh.github.com"}, true},
		{"gitee by hostname", HostConfig{Name: "gitee", User: "root", HostName: "gitee.com"}, true},
		{"normal server", HostConfig{Name: "cdcp-beta", User: "root", HostName: "198.51.100.10"}, false},
		{"empty", HostConfig{Name: "x"}, false},
		{"gitlab subdomain", HostConfig{Name: "gl", HostName: "git.mygitlab.com"}, false},
		{"aliyun codeup", HostConfig{Name: "ali", User: "git", HostName: "codeup.aliyun.com"}, true},
	}
	for _, c := range cases {
		got := IsGitHost(c.h)
		if got != c.want {
			t.Errorf("%s: want %v got %v (host=%+v)", c.name, c.want, got, c.h)
		}
	}
}
