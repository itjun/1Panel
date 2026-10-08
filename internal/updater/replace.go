package updater

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// swapPath 把 target 换成 replacement：先改名旧件为 target.old，再挪入新件；
// 第二步失败时把旧件改回原名。target.old 留到下次启动由 Cleanup 删除。
func swapPath(target, replacement string) error {
	old := target + ".old"
	if err := os.RemoveAll(old); err != nil {
		return fmt.Errorf("清理旧备份失败：%w", err)
	}
	if err := os.Rename(target, old); err != nil {
		return err
	}
	if err := os.Rename(replacement, target); err != nil {
		if rbErr := os.Rename(old, target); rbErr != nil {
			return fmt.Errorf("替换失败且回滚失败：%v；回滚：%v", err, rbErr)
		}
		return fmt.Errorf("替换失败，已回滚：%w", err)
	}
	return nil
}

// replaceExeFromZip 从 zip 中取出与 exe 同名（大小写不敏感）的可执行文件，原地替换 exe。
// Windows 允许改名正在运行的 exe，因此可以直接替换后重启。
func replaceExeFromZip(archive, exe string) error {
	zr, err := zip.OpenReader(archive)
	if err != nil {
		return fmt.Errorf("打开安装包失败：%w", err)
	}
	defer zr.Close()

	want := strings.ToLower(path.Base(strings.ReplaceAll(exe, "\\", "/")))
	var entry *zip.File
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := strings.ToLower(path.Base(f.Name))
		if name == want {
			entry = f
			break
		}
		if entry == nil && strings.HasSuffix(name, ".exe") {
			entry = f
		}
	}
	if entry == nil {
		return errors.New("安装包内没有可执行文件")
	}

	staged := exe + ".new"
	if err := extractFile(entry, staged); err != nil {
		_ = os.Remove(staged)
		return err
	}
	if err := swapPath(exe, staged); err != nil {
		_ = os.Remove(staged)
		return err
	}
	return nil
}

// replaceExeFromTarGz 从 tar.gz 中取出与 exe 同名的普通文件，原地替换 exe。
// Linux 上正在运行的二进制同样可以改名，替换后重启即生效。
func replaceExeFromTarGz(archive, exe string) error {
	f, err := os.Open(archive)
	if err != nil {
		return fmt.Errorf("打开安装包失败：%w", err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("安装包不是有效的 tar.gz：%w", err)
	}
	defer gz.Close()

	want := filepath.Base(exe)
	staged := exe + ".new"
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return errors.New("安装包内没有可执行文件 " + want)
		}
		if err != nil {
			return fmt.Errorf("读取安装包失败：%w", err)
		}
		if hdr.Typeflag != tar.TypeReg || path.Base(hdr.Name) != want {
			continue
		}
		if err := writeExe(tr, staged); err != nil {
			_ = os.Remove(staged)
			return err
		}
		break
	}
	if err := swapPath(exe, staged); err != nil {
		_ = os.Remove(staged)
		return err
	}
	return nil
}

func extractFile(f *zip.File, dst string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	return writeExe(rc, dst)
}

func writeExe(r io.Reader, dst string) error {
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, r); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}
