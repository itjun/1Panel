package updater

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestExtractAppWithDitto(t *testing.T) {
	src := t.TempDir()
	app := filepath.Join(src, "1Panel.app")
	if err := os.MkdirAll(filepath.Join(app, "Contents", "MacOS"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(app, "Contents", "MacOS", "1Panel"), []byte("bin"), 0o755)
	_ = os.Symlink("MacOS/1Panel", filepath.Join(app, "Contents", "link"))
	archive := filepath.Join(t.TempDir(), "pkg.zip")
	if out, err := exec.Command("/usr/bin/ditto", "-c", "-k", "--keepParent", app, archive).CombinedOutput(); err != nil {
		t.Fatalf("ditto 打包失败：%v %s", err, out)
	}

	got, err := extractApp(archive, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(got) != "1Panel.app" {
		t.Fatalf("解出路径不符：%s", got)
	}
	if target, err := os.Readlink(filepath.Join(got, "Contents", "link")); err != nil || target != "MacOS/1Panel" {
		t.Fatalf("符号链接应保留：%q %v", target, err)
	}
}
