package aptsource

import (
	"strings"
	"testing"
)

func TestRewriteClassicJammyToAliyun(t *testing.T) {
	in := `deb http://archive.ubuntu.com/ubuntu jammy main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu jammy-updates main restricted universe multiverse
deb http://security.ubuntu.com/ubuntu jammy-security main restricted universe multiverse
`
	out := RewriteContent(in, "ubuntu", "/etc/apt/sources.list", Mirror{ID: IDAliyun, Host: "mirrors.aliyun.com"})
	if strings.Count(out, "mirrors.aliyun.com/ubuntu") != 3 {
		t.Fatalf("want 3 aliyun ubuntu lines, got:\n%s", out)
	}
	if strings.Contains(out, "archive.ubuntu.com") || strings.Contains(out, "security.ubuntu.com") {
		t.Fatalf("old hosts remain:\n%s", out)
	}
}

func TestRewriteClassicRestoreOfficial(t *testing.T) {
	in := `deb http://mirrors.aliyun.com/ubuntu jammy main
deb http://mirrors.aliyun.com/ubuntu jammy-security main
`
	out := RewriteContent(in, "ubuntu", "/etc/apt/sources.list", Mirror{ID: IDOfficial, Host: "archive.ubuntu.com"})
	if !strings.Contains(out, "http://archive.ubuntu.com/ubuntu jammy main") {
		t.Fatalf("archive not restored:\n%s", out)
	}
	if !strings.Contains(out, "http://security.ubuntu.com/ubuntu jammy-security") {
		t.Fatalf("security not restored:\n%s", out)
	}
}

func TestRewriteLeavesPPA(t *testing.T) {
	in := `deb http://archive.ubuntu.com/ubuntu jammy main
deb https://ppa.launchpadcontent.net/nginx/stable/ubuntu jammy main
`
	out := RewriteContent(in, "ubuntu", "/etc/apt/sources.list", Mirror{ID: IDTsinghua, Host: "mirrors.tuna.tsinghua.edu.cn"})
	if !strings.Contains(out, "ppa.launchpadcontent.net") {
		t.Fatal("PPA rewritten")
	}
	if !strings.Contains(out, "mirrors.tuna.tsinghua.edu.cn/ubuntu") {
		t.Fatalf("archive not rewritten:\n%s", out)
	}
}

func TestRewriteDeb822Noble(t *testing.T) {
	in := `Types: deb
URIs: http://archive.ubuntu.com/ubuntu
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu
Suites: noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
`
	ali := RewriteContent(in, "ubuntu", "/etc/apt/sources.list.d/ubuntu.sources", Mirror{ID: IDTsinghua, Host: "mirrors.tuna.tsinghua.edu.cn"})
	if strings.Count(ali, "URIs: http://mirrors.tuna.tsinghua.edu.cn/ubuntu") != 2 {
		t.Fatalf("want 2 tuna URIs, got:\n%s", ali)
	}
	off := RewriteContent(ali, "ubuntu", "/etc/apt/sources.list.d/ubuntu.sources", Mirror{ID: IDOfficial, Host: "archive.ubuntu.com"})
	if !strings.Contains(off, "URIs: http://archive.ubuntu.com/ubuntu") {
		t.Fatalf("archive URI missing:\n%s", off)
	}
	if !strings.Contains(off, "URIs: http://security.ubuntu.com/ubuntu") {
		t.Fatalf("security URI missing:\n%s", off)
	}
}

func TestRewriteDebianClassic(t *testing.T) {
	in := `deb http://deb.debian.org/debian bookworm main
deb http://security.debian.org/debian-security bookworm-security main
`
	out := RewriteContent(in, "debian", "/etc/apt/sources.list", Mirror{ID: IDAliyun, Host: "mirrors.aliyun.com"})
	if !strings.Contains(out, "http://mirrors.aliyun.com/debian bookworm main") {
		t.Fatalf("debian archive:\n%s", out)
	}
	if !strings.Contains(out, "http://mirrors.aliyun.com/debian-security") {
		t.Fatalf("debian-security:\n%s", out)
	}
}
