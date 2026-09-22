package main

import (
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"diteng-pannel/internal/monitor"

	"github.com/pkg/sftp"
)

// ListSftp 用 SFTP 列远程目录（不走 agent）。
func (s *Files) ListSftp(host, dir string) ([]monitor.FileEntry, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		dir = "/"
	}
	var entries []monitor.FileEntry
	err := s.withSFTP(host, func(sc *sftp.Client) error {
		var e error
		entries, e = readSftpDir(sc, dir)
		return e
	})
	return entries, err
}

// SftpHomeDir 远程登录用户家目录。
func (s *Files) SftpHomeDir(host string) (string, error) {
	var wd string
	err := s.withSFTP(host, func(sc *sftp.Client) error {
		got, e := sc.Getwd()
		if e != nil {
			return e
		}
		wd = got
		return nil
	})
	if err != nil || strings.TrimSpace(wd) == "" {
		if err != nil {
			return "", err
		}
		return "/", nil
	}
	return wd, nil
}

// withSFTP 打开一次 SFTP。读的过程中发现连接已死，就丢掉缓存再连一次。
func (s *Files) withSFTP(host string, fn func(*sftp.Client) error) error {
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return err
	}
	err = fn(sc)
	_ = sc.Close()
	if err == nil || !sshConnDead(err) {
		return err
	}
	s.sshMgr.Drop(host)
	sc, err = openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return err
	}
	defer sc.Close()
	return fn(sc)
}

// ListLocalDir 列本机目录，给 SFTP 左栏用。
func (s *Files) ListLocalDir(dir string) ([]monitor.FileEntry, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		dir = home
	}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读本机目录失败: %w", err)
	}
	out := make([]monitor.FileEntry, 0, len(ents))
	for _, e := range ents {
		// 隐藏文件也返回，由 SFTP 界面的开关决定是否显示。
		if e.Name() == "." || e.Name() == ".." {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		full := filepath.Join(dir, e.Name())
		mode := info.Mode().String()
		out = append(out, monitor.FileEntry{
			Name:    e.Name(),
			Path:    full,
			IsDir:   e.IsDir(),
			Size:    uint64(info.Size()),
			Mode:    mode,
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// LocalHomeDir 本机用户家目录。
func (s *Files) LocalHomeDir() (string, error) {
	return os.UserHomeDir()
}

// LocalExistingNames 返回本机目录里已经存在的名字。给拖拽冲突弹窗用。
func (s *Files) LocalExistingNames(dir string, names []string) ([]string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, fmt.Errorf("本机目录为空")
	}
	return existingNames(names, func(name string) bool {
		_, err := os.Stat(filepath.Join(dir, name))
		return err == nil
	}), nil
}

// SftpExistingNames 返回远程目录里已经存在的名字。给拖拽冲突弹窗用。
func (s *Files) SftpExistingNames(host, dir string, names []string) ([]string, error) {
	dir = path.Clean(strings.TrimSpace(dir))
	if dir == "" || dir == "." {
		dir = "/"
	}
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return nil, err
	}
	defer sc.Close()
	return existingNames(names, func(name string) bool {
		_, statErr := sc.Stat(path.Join(dir, name))
		return statErr == nil
	}), nil
}

// DownloadSftp 把远程文件或目录下到本地目录，返回本地完整路径。
// 目录按原名递归拷贝到 localDir 下。
func (s *Files) DownloadSftp(host, remotePath, localDir string) (string, error) {
	localDir, err := prepareLocalDownloadDir(localDir)
	if err != nil {
		return "", err
	}
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return "", err
	}
	defer sc.Close()
	return downloadOneSftp(sc, remotePath, localDir)
}

// DownloadSftpPaths 一次连接下载多个远程文件或目录到同一本机目录。
func (s *Files) DownloadSftpPaths(host string, remotePaths []string, localDir string) error {
	if len(remotePaths) == 0 {
		return fmt.Errorf("没有要下载的路径")
	}
	localDir, err := prepareLocalDownloadDir(localDir)
	if err != nil {
		return err
	}
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return err
	}
	defer sc.Close()
	for _, rp := range remotePaths {
		if _, err := downloadOneSftp(sc, rp, localDir); err != nil {
			return err
		}
	}
	return nil
}

// DownloadSftpPathsAs 按冲突策略下载。mode 为 overwrite 或 rename。
func (s *Files) DownloadSftpPathsAs(host string, remotePaths []string, localDir, mode string) error {
	mode, err := normalizeConflictMode(mode)
	if err != nil {
		return err
	}
	if len(remotePaths) == 0 {
		return fmt.Errorf("没有要下载的路径")
	}
	localDir, err = prepareLocalDownloadDir(localDir)
	if err != nil {
		return err
	}
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return err
	}
	defer sc.Close()

	reserved := map[string]bool{}
	for _, rp := range remotePaths {
		rp = path.Clean(strings.TrimSpace(rp))
		if rp == "" || rp == "/" || rp == "." {
			return fmt.Errorf("不能下载该路径")
		}
		info, statErr := sc.Stat(rp)
		if statErr != nil {
			return fmt.Errorf("打开远程路径失败: %w", statErr)
		}
		destName, replace, nameErr := pickConflictName(path.Base(rp), mode, reserved, func(name string) bool {
			_, err := os.Stat(filepath.Join(localDir, name))
			return err == nil
		})
		if nameErr != nil {
			return nameErr
		}
		dest := filepath.Join(localDir, destName)
		if replace {
			if err := deleteOneLocal(dest); err != nil {
				return err
			}
		}
		if err := writeSftpToLocal(sc, rp, dest, info.IsDir()); err != nil {
			return err
		}
	}
	return nil
}

// DeleteLocalPaths 删除本机文件或目录（递归）。拒绝删除主目录和盘符根下的系统目录本身。
func (s *Files) DeleteLocalPaths(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("没有要删除的路径")
	}
	for _, p := range paths {
		if err := deleteOneLocal(p); err != nil {
			return err
		}
	}
	return nil
}

// SftpMkdir 用 SFTP 在远程创建目录（不走 agent）。
func (s *Files) SftpMkdir(host, dir string) error {
	dir = path.Clean(strings.TrimSpace(dir))
	if dir == "" || dir == "/" || dir == "." {
		return fmt.Errorf("目录名不能为空")
	}
	return s.withSFTP(host, func(sc *sftp.Client) error {
		if _, err := sc.Stat(dir); err == nil {
			return fmt.Errorf("「%s」已存在", path.Base(dir))
		}
		if err := sc.Mkdir(dir); err != nil {
			return fmt.Errorf("创建目录失败: %w", err)
		}
		return nil
	})
}

// SftpCreateFile 用 SFTP 在远程创建空文件；名字已被占用时报错，不覆盖已有内容。
func (s *Files) SftpCreateFile(host, file string) error {
	file = path.Clean(strings.TrimSpace(file))
	if file == "" || file == "/" || file == "." {
		return fmt.Errorf("文件名不能为空")
	}
	return s.withSFTP(host, func(sc *sftp.Client) error {
		f, err := sc.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
		if err != nil {
			if _, statErr := sc.Stat(file); statErr == nil {
				return fmt.Errorf("「%s」已存在", path.Base(file))
			}
			return fmt.Errorf("创建文件失败: %w", err)
		}
		return f.Close()
	})
}

// DeleteSftpPaths 用 SFTP 删除远程文件或目录（递归，不走 agent）。
func (s *Files) DeleteSftpPaths(host string, paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("没有要删除的路径")
	}
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return err
	}
	defer sc.Close()
	for _, p := range paths {
		if err := deleteOneSftp(sc, p); err != nil {
			return err
		}
	}
	return nil
}

func prepareLocalDownloadDir(localDir string) (string, error) {
	localDir = strings.TrimSpace(localDir)
	if localDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		localDir = filepath.Join(home, "Downloads")
	}
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		return "", fmt.Errorf("创建本机目录失败: %w", err)
	}
	return localDir, nil
}

func downloadOneSftp(sc *sftp.Client, remotePath, localDir string) (string, error) {
	remotePath = path.Clean(strings.TrimSpace(remotePath))
	if remotePath == "" || remotePath == "/" || remotePath == "." {
		return "", fmt.Errorf("不能下载该路径")
	}
	info, err := sc.Stat(remotePath)
	if err != nil {
		return "", fmt.Errorf("打开远程路径失败: %w", err)
	}
	dest := filepath.Join(localDir, path.Base(remotePath))
	if err := writeSftpToLocal(sc, remotePath, dest, info.IsDir()); err != nil {
		return "", err
	}
	return dest, nil
}

func writeSftpToLocal(sc *sftp.Client, remotePath, localPath string, isDir bool) error {
	if isDir {
		return downloadSftpDir(sc, remotePath, localPath, map[string]bool{})
	}
	return downloadSftpFile(sc, remotePath, localPath)
}

func downloadSftpFile(sc *sftp.Client, remotePath, localPath string) error {
	rf, err := sc.Open(remotePath)
	if err != nil {
		return fmt.Errorf("打开远程文件失败: %w", err)
	}
	defer rf.Close()
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return fmt.Errorf("创建本机目录失败: %w", err)
	}
	lf, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("创建本机文件失败: %w", err)
	}
	defer lf.Close()
	if _, err := io.Copy(lf, rf); err != nil {
		return fmt.Errorf("下载失败: %w", err)
	}
	return nil
}

func downloadSftpDir(sc *sftp.Client, remoteDir, localDir string, seen map[string]bool) error {
	if seen[remoteDir] {
		return nil
	}
	seen[remoteDir] = true
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		return fmt.Errorf("创建本机目录失败: %w", err)
	}
	ents, err := sc.ReadDir(remoteDir)
	if err != nil {
		return fmt.Errorf("读取远程目录失败: %w", err)
	}
	for _, e := range ents {
		name := e.Name()
		if name == "." || name == ".." {
			continue
		}
		remoteChild := path.Join(remoteDir, name)
		localChild := filepath.Join(localDir, name)
		if e.IsDir() {
			if err := downloadSftpDir(sc, remoteChild, localChild, seen); err != nil {
				return err
			}
			continue
		}
		if err := downloadSftpFile(sc, remoteChild, localChild); err != nil {
			return err
		}
	}
	return nil
}

func deleteOneLocal(p string) error {
	p = strings.TrimSpace(p)
	if p == "" {
		return fmt.Errorf("路径为空")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return err
	}
	abs = filepath.Clean(abs)
	if err := rejectLocalDelete(abs); err != nil {
		return err
	}
	if err := os.RemoveAll(abs); err != nil {
		return fmt.Errorf("删除失败: %w", err)
	}
	return nil
}

func rejectLocalDelete(abs string) error {
	if abs == string(filepath.Separator) || abs == "." {
		return fmt.Errorf("拒绝删除: %s", abs)
	}
	home, err := os.UserHomeDir()
	if err == nil && filepath.Clean(home) == abs {
		return fmt.Errorf("拒绝删除用户主目录")
	}
	parent := filepath.Dir(abs)
	if parent == string(filepath.Separator) {
		blocked := map[string]bool{
			"System": true, "Applications": true, "Library": true,
			"Users": true, "Volumes": true, "private": true,
			"opt": true, "usr": true, "bin": true, "sbin": true,
			"etc": true, "var": true, "tmp": true, "dev": true,
			"cores": true, "home": true,
		}
		if blocked[filepath.Base(abs)] {
			return fmt.Errorf("拒绝删除系统目录: %s", abs)
		}
	}
	return nil
}

func deleteOneSftp(sc *sftp.Client, p string) error {
	p = path.Clean(strings.TrimSpace(p))
	if err := rejectRemoteDelete(p); err != nil {
		return err
	}
	info, err := sc.Stat(p)
	if err != nil {
		return fmt.Errorf("找不到 %s: %w", p, err)
	}
	if !info.IsDir() {
		if err := sc.Remove(p); err != nil {
			return fmt.Errorf("删除失败: %w", err)
		}
		return nil
	}
	return removeSftpDir(sc, p, map[string]bool{})
}

func rejectRemoteDelete(p string) error {
	if p == "/" || p == "." || p == "" {
		return fmt.Errorf("拒绝删除根目录")
	}
	if path.Dir(p) == "/" {
		blocked := map[string]bool{
			"bin": true, "boot": true, "dev": true, "etc": true,
			"lib": true, "lib64": true, "proc": true, "sbin": true,
			"sys": true, "usr": true, "run": true, "var": true,
			"opt": true, "tmp": true,
		}
		if blocked[path.Base(p)] {
			return fmt.Errorf("拒绝删除系统目录: %s", p)
		}
	}
	return nil
}

func removeSftpDir(sc *sftp.Client, dir string, seen map[string]bool) error {
	if seen[dir] {
		return nil
	}
	seen[dir] = true
	ents, err := sc.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("读取目录失败: %w", err)
	}
	for _, e := range ents {
		name := e.Name()
		if name == "." || name == ".." {
			continue
		}
		child := path.Join(dir, name)
		if e.IsDir() {
			if err := removeSftpDir(sc, child, seen); err != nil {
				return err
			}
			continue
		}
		if err := sc.Remove(child); err != nil {
			return fmt.Errorf("删除失败: %w", err)
		}
	}
	if err := sc.RemoveDirectory(dir); err != nil {
		return fmt.Errorf("删除目录失败: %w", err)
	}
	return nil
}

func readSftpDir(sc *sftp.Client, dir string) ([]monitor.FileEntry, error) {
	ents, err := sc.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("列目录失败: %w", err)
	}
	out := make([]monitor.FileEntry, 0, len(ents))
	for _, info := range ents {
		name := info.Name()
		if name == "." || name == ".." {
			continue
		}
		full := path.Join(dir, name)
		out = append(out, monitor.FileEntry{
			Name:    name,
			Path:    full,
			IsDir:   info.IsDir(),
			Size:    uint64(info.Size()),
			Mode:    info.Mode().String(),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
			Owner:   "",
			Group:   "",
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func existingNames(names []string, exists func(string) bool) []string {
	hit := make([]string, 0)
	seen := map[string]bool{}
	for _, raw := range names {
		name := path.Base(strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/")))
		if name == "" || name == "." || name == ".." || seen[name] {
			continue
		}
		seen[name] = true
		if exists(name) {
			hit = append(hit, name)
		}
	}
	return hit
}

func normalizeConflictMode(mode string) (string, error) {
	mode = strings.TrimSpace(strings.ToLower(mode))
	if mode == "overwrite" || mode == "rename" {
		return mode, nil
	}
	return "", fmt.Errorf("冲突处理只能是 overwrite 或 rename")
}

// pickConflictName 决定落到目标目录时用的名字。
// rename：已有同名就改成「名字 1」「名字 2」，扩展名留在最后。
func pickConflictName(name, mode string, reserved map[string]bool, exists func(string) bool) (dest string, replace bool, err error) {
	taken := func(n string) bool {
		if reserved[n] {
			return true
		}
		return exists(n)
	}
	if !taken(name) {
		reserved[name] = true
		return name, false, nil
	}
	if mode == "overwrite" {
		reserved[name] = true
		return name, true, nil
	}
	for n := 1; n < 10000; n++ {
		candidate := numberedName(name, n)
		if !taken(candidate) {
			reserved[candidate] = true
			return candidate, false, nil
		}
	}
	return "", false, fmt.Errorf("找不到可用的文件名: %s", name)
}

func numberedName(name string, n int) string {
	ext := path.Ext(name)
	if ext == "" || ext == name {
		return fmt.Sprintf("%s %d", name, n)
	}
	return fmt.Sprintf("%s %d%s", strings.TrimSuffix(name, ext), n, ext)
}

func removeRemoteIfPresent(sc *sftp.Client, p string) error {
	if _, err := sc.Stat(p); err != nil {
		return nil
	}
	return deleteOneSftp(sc, p)
}
