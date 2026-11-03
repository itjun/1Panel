//go:build linux

package updater

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// 在独立进程内替换真实的运行文件，覆盖 /proc/self/exe 随 rename 变成 .old 的场景。
func TestLinuxUpdateKeepsExecutableIdentity(t *testing.T) {
	if mode := os.Getenv("ONEPANEL_TEST_UPDATE_PROCESS"); mode != "" {
		dir := os.Getenv("ONEPANEL_TEST_UPDATE_DIR")
		target := filepath.Join(dir, "1Panel")
		if mode != "restarted" {
			for i := 0; i < 2; i++ {
				if err := Apply(filepath.Join(dir, "update.tar.gz")); err != nil {
					t.Fatalf("第 %d 次更新失败：%v", i+1, err)
				}
			}
		}
		exe, err := RestartExecutable()
		if err != nil || exe != target {
			t.Fatalf("更新/重启必须使用正式路径，得到 %q, %v", exe, err)
		}
		if mode == "restarted" {
			Cleanup()
			if _, err := os.Stat(target + ".old"); !os.IsNotExist(err) {
				t.Fatalf("重启后应清理旧备份：%v", err)
			}
			return
		}
		cmd := exec.Command(exe, "-test.run=^TestLinuxUpdateKeepsExecutableIdentity$")
		cmd.Env = append(os.Environ(), "ONEPANEL_TEST_UPDATE_PROCESS=restarted")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("重启失败：%v\n%s", err, out)
		}
		return
	}

	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"1Panel", "1Panel.old"} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			for _, file := range []string{"1Panel", name} {
				if err := os.WriteFile(filepath.Join(dir, file), binary, 0o755); err != nil {
					t.Fatal(err)
				}
			}
			f, err := os.Create(filepath.Join(dir, "update.tar.gz"))
			if err != nil {
				t.Fatal(err)
			}
			gz := gzip.NewWriter(f)
			tw := tar.NewWriter(gz)
			if err := tw.WriteHeader(&tar.Header{Name: "release/1Panel", Mode: 0o755, Size: int64(len(binary)), Typeflag: tar.TypeReg}); err != nil {
				t.Fatal(err)
			}
			if _, err := tw.Write(binary); err != nil {
				t.Fatal(err)
			}
			for _, err := range []error{tw.Close(), gz.Close(), f.Close()} {
				if err != nil {
					t.Fatal(err)
				}
			}
			cmd := exec.Command(filepath.Join(dir, name), "-test.run=^TestLinuxUpdateKeepsExecutableIdentity$")
			cmd.Env = append(os.Environ(), "ONEPANEL_TEST_UPDATE_PROCESS=update", "ONEPANEL_TEST_UPDATE_DIR="+dir)
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("更新链路失败：%v\n%s", err, out)
			}
		})
	}
}
