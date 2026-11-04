package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunUpdateApplyFlagValidation(t *testing.T) {
	for _, args := range [][]string{
		{},
		{"--deb", "/tmp/update.deb"},          // 缺 --sha256
		{"--sha256", strings.Repeat("a", 64)}, // 缺 --deb
		{"--unknown"},
		{"--deb", "/tmp/update.deb", "--sha256", strings.Repeat("a", 64), "多余参数"},
	} {
		if code := RunUpdateApply(args); code != 1 {
			t.Fatalf("参数 %v 应报错退出，得到退出码 %d", args, code)
		}
	}
}

// 参数合法但非 root：在 euid 校验处拒绝（测试进程通常非 root）。
func TestRunUpdateApplyRequiresRoot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("以 root 运行时跳过")
	}
	deb := filepath.Join(t.TempDir(), "update.deb")
	if err := os.WriteFile(deb, []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}
	if code := RunUpdateApply([]string{"--deb", deb, "--sha256", strings.Repeat("a", 64)}); code != 1 {
		t.Fatalf("非 root 应拒绝，退出码 %d", code)
	}
}

func TestCopyAndVerifyDeb(t *testing.T) {
	body := []byte("deb-bytes")
	want := sha256.Sum256(body)
	dir := t.TempDir()
	src := filepath.Join(dir, "update.deb")
	if err := os.WriteFile(src, body, 0o644); err != nil {
		t.Fatal(err)
	}

	t.Run("哈希一致放行", func(t *testing.T) {
		dst := filepath.Join(dir, "staged-ok.deb")
		if err := copyAndVerifyDeb(src, hex.EncodeToString(want[:]), dst); err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(dst)
		if err != nil || string(got) != string(body) {
			t.Fatalf("副本内容应与源一致：%v", err)
		}
	})

	t.Run("哈希不符拒绝", func(t *testing.T) {
		other := sha256.Sum256([]byte("tampered"))
		dst := filepath.Join(dir, "staged-bad.deb")
		err := copyAndVerifyDeb(src, hex.EncodeToString(other[:]), dst)
		if err == nil || !strings.Contains(err.Error(), "哈希与更新清单不符") {
			t.Fatalf("哈希不符应拒绝安装：%v", err)
		}
	})

	t.Run("非法哈希拒绝", func(t *testing.T) {
		dst := filepath.Join(dir, "staged-invalid.deb")
		if err := copyAndVerifyDeb(src, "not-hex", dst); err == nil {
			t.Fatal("非法 SHA-256 应拒绝")
		}
	})

	t.Run("源缺失拒绝", func(t *testing.T) {
		dst := filepath.Join(dir, "staged-missing.deb")
		if err := copyAndVerifyDeb(filepath.Join(dir, "absent.deb"), hex.EncodeToString(want[:]), dst); err == nil {
			t.Fatal("源文件缺失应报错")
		}
	})
}
