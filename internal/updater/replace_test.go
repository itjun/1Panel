package updater

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func TestSwapPathRollsBack(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "1Panel.app")
	if err := os.MkdirAll(filepath.Join(target, "Contents"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := swapPath(target, filepath.Join(dir, "missing.app")); err == nil {
		t.Fatal("新包不存在时应报错")
	}
	if _, err := os.Stat(filepath.Join(target, "Contents")); err != nil {
		t.Fatal("失败后旧包应已回滚到原位")
	}
	if _, err := os.Stat(target + ".old"); !os.IsNotExist(err) {
		t.Fatal("回滚后不应残留 .old")
	}
}

func TestSwapPathReplaces(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "1Panel.app")
	repl := filepath.Join(dir, "staging", "1Panel.app")
	_ = os.MkdirAll(target, 0o755)
	_ = os.WriteFile(filepath.Join(target, "v"), []byte("old"), 0o644)
	_ = os.MkdirAll(repl, 0o755)
	_ = os.WriteFile(filepath.Join(repl, "v"), []byte("new"), 0o644)
	if err := swapPath(target, repl); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(target, "v")); string(b) != "new" {
		t.Fatalf("应为新内容：%q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(target+".old", "v")); string(b) != "old" {
		t.Fatalf("旧包应保留为 .old：%q", b)
	}
}

func TestReplaceExeFromTarGz(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "1Panel")
	_ = os.WriteFile(exe, []byte("old-bin"), 0o755)

	archive := filepath.Join(dir, "pkg.tar.gz")
	f, _ := os.Create(archive)
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	add := func(name string, body string) {
		_ = tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg})
		_, _ = tw.Write([]byte(body))
	}
	add("1Panel-v1.2.0-linux-amd64/1Panel.desktop", "[Desktop Entry]")
	add("1Panel-v1.2.0-linux-amd64/1Panel", "new-bin")
	_ = tw.Close()
	_ = gz.Close()
	_ = f.Close()

	if err := replaceExeFromTarGz(archive, exe); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "new-bin" {
		t.Fatalf("二进制未替换：%q", b)
	}
	if st, _ := os.Stat(exe); st.Mode().Perm()&0o100 == 0 {
		t.Fatal("新二进制应可执行")
	}

	missing := filepath.Join(dir, "other")
	_ = os.WriteFile(missing, []byte("x"), 0o755)
	if err := replaceExeFromTarGz(archive, missing); err == nil {
		t.Fatal("包内没有同名文件时应报错")
	}
	if b, _ := os.ReadFile(missing); string(b) != "x" {
		t.Fatal("失败时不应改动原文件")
	}
}

func TestReplaceExeFromZip(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "1Panel.exe")
	_ = os.WriteFile(exe, []byte("old-exe"), 0o755)

	archive := filepath.Join(dir, "pkg.zip")
	f, _ := os.Create(archive)
	zw := zip.NewWriter(f)
	w, _ := zw.Create("1panel.EXE")
	_, _ = w.Write([]byte("new-exe"))
	_ = zw.Close()
	_ = f.Close()

	if err := replaceExeFromZip(archive, exe); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "new-exe" {
		t.Fatalf("exe 未替换：%q", b)
	}
	if _, err := os.Stat(exe + ".new"); !os.IsNotExist(err) {
		t.Fatal("不应残留 .new")
	}
}
