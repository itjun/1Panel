package iperfres

import "testing"

func TestAssetName(t *testing.T) {
	cases := []struct{ goos, arch, want string }{
		{"linux", "x86_64", "iperf3-amd64"},
		{"linux", "amd64", "iperf3-amd64"},
		{"linux", "aarch64", "iperf3-arm64v8"},
		{"linux", "arm64", "iperf3-arm64v8"},
		{"darwin", "arm64", "iperf3-arm64-osx-14"},
		{"darwin", "aarch64", "iperf3-arm64-osx-14"},
		{"darwin", "x86_64", "iperf3-amd64-osx-15"},
		{"windows", "amd64", "win64/iperf3.exe"},
		{"windows", "x86_64", "win64/iperf3.exe"},
		{"windows", "arm64", "win64/iperf3.exe"}, // arm64 走 x64 模拟
	}
	for _, c := range cases {
		got, err := assetName(c.goos, c.arch)
		if err != nil || got != c.want {
			t.Errorf("assetName(%s, %s) = %q, %v；期望 %q", c.goos, c.arch, got, err, c.want)
		}
	}
	for _, c := range []struct{ goos, arch string }{
		{"freebsd", "amd64"}, {"windows", "386"}, {"linux", "riscv64"},
	} {
		if _, err := assetName(c.goos, c.arch); err == nil {
			t.Errorf("assetName(%s, %s) 不应支持", c.goos, c.arch)
		}
	}
}

func TestFiles(t *testing.T) {
	t.Run("posix 单文件", func(t *testing.T) {
		fl, err := Files("linux", "x86_64")
		if err != nil {
			t.Skipf("内置产物未下载：%v", err)
		}
		if len(fl) != 1 || fl[0].Name != "iperf3-amd64" {
			t.Fatalf("linux 产物异常：%+v", fl)
		}
		if _, _, err := Binary("linux", "x86_64"); err != nil {
			t.Errorf("Binary(linux) 应可用：%v", err)
		}
	})
	t.Run("windows 入口在前", func(t *testing.T) {
		fl, err := Files("windows", "amd64")
		if err != nil {
			t.Skipf("内置产物未下载：%v", err)
		}
		if len(fl) < 2 || fl[0].Name != "iperf3.exe" {
			t.Fatalf("win64 产物异常：%+v", fl)
		}
		for _, f := range fl {
			if f.SHA256 == "" || len(f.Data) == 0 {
				t.Fatalf("win64 产物缺数据：%+v", f)
			}
		}
		if _, _, err := Binary("windows", "amd64"); err == nil {
			t.Error("windows 为多文件产物，Binary 应报错")
		}
	})
}
