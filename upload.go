package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"

	"diteng-pannel/internal/filetext"
	"diteng-pannel/internal/sshd"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Files 文件服务：上传（SFTP）+ 进度 + 可选编码规范化
type Files App

// ============ 文件上传（SFTP）+ 进度 + 可选编码规范化 ============

const uploadProgressEvent = "upload:progress" // 前端监听的事件名
const uploadChunkSize = 32 * 1024             // 分块上传粒度
const uploadNormalizeLimit = 8 * 1024 * 1024  // 超过 8MB 的文件不做编码转换

// UploadProgress 上传进度事件 payload（整体百分比 + 当前文件）
type UploadProgress struct {
	Uploaded int64  `json:"uploaded"`
	Total    int64  `json:"total"`
	Current  string `json:"current"`
	Done     bool   `json:"done"`
}

// progressTracker 跟踪一次上传任务（单文件或多文件）的累计进度
type progressTracker struct {
	uploaded int64
	total    int64
}

func (p *progressTracker) add(n int64) { p.uploaded += n }

func (p *progressTracker) emit(current string) {
	application.Get().Event.Emit(uploadProgressEvent, UploadProgress{
		Uploaded: p.uploaded,
		Total:    p.total,
		Current:  current,
	})
}

// UploadFile 上传本地单文件到远程主机指定目录
// localPath: 本地文件绝对路径（由 Wails 文件拖拽提供）
// remoteDir: 远程目标目录（绝对路径，会自动创建）
// normalize: true 时若文件是「非标准文本」则转为 UTF-8(无BOM)+LF 后再上传
// 返回上传后的完整远程路径
func (s *Files) UploadFile(host, localPath, remoteDir string, normalize bool) (string, error) {
	info, err := os.Stat(localPath)
	if err != nil {
		return "", fmt.Errorf("本地文件不存在: %w", err)
	}
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return "", err
	}
	defer sc.Close()

	prog := &progressTracker{total: info.Size()}
	remote, err := uploadFileSc(sc, localPath, remoteDir, normalize, prog)
	// 无论成败发 done，让前端进度条归位
	application.Get().Event.Emit(uploadProgressEvent, UploadProgress{
		Uploaded: prog.total, Total: prog.total, Done: true,
	})
	return remote, err
}

// UploadDir 递归上传本地文件夹到远程主机，保留目录结构
// localDir: 本地文件夹绝对路径
// remoteDir: 远程目标目录（绝对路径，会自动创建）
// normalize: true 时对其中「非标准文本」文件转为 UTF-8(无BOM)+LF
func (s *Files) UploadDir(host, localDir, remoteDir string, normalize bool) (string, error) {
	if info, err := os.Stat(localDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("本地目录不存在: %s", localDir)
	}
	// 先统计总字节数，用于整体进度百分比
	var total int64
	_ = filepath.Walk(localDir, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return "", err
	}
	defer sc.Close()

	prog := &progressTracker{total: total}
	// 保留文件夹自身名称：原样拷贝到 remoteDir/<dirName>/ 下，不铺平
	dirName := filepath.Base(localDir)
	err = filepath.Walk(localDir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, rerr := filepath.Rel(localDir, p)
		if rerr != nil {
			return rerr
		}
		target := path.Join(remoteDir, dirName, filepath.ToSlash(rel))
		if info.IsDir() {
			return sc.MkdirAll(target)
		}
		_, e := uploadFileSc(sc, p, path.Dir(target), normalize, prog)
		return e
	})
	application.Get().Event.Emit(uploadProgressEvent, UploadProgress{
		Uploaded: prog.total, Total: prog.total, Done: true,
	})
	return remoteDir, err
}

// UploadPaths 批量上传多个本地路径（文件/文件夹混合）到远程目录，用于拖拽上传。
// convertPaths: 需要「转 UTF-8(无BOM)+LF」的本地文件绝对路径集合（来自编码检查弹窗勾选）；
// 文件夹内的文件按其绝对路径是否命中 convertPaths 决定是否转换。
func (s *Files) UploadPaths(host string, localPaths []string, convertPaths []string, remoteDir string) error {
	convertSet := make(map[string]bool, len(convertPaths))
	for _, p := range convertPaths {
		convertSet[p] = true
	}
	// 统计总字节数，用于整体进度百分比
	var total int64
	for _, p := range localPaths {
		_ = filepath.Walk(p, func(_ string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				total += info.Size()
			}
			return nil
		})
	}
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return err
	}
	defer sc.Close()

	prog := &progressTracker{total: total}
	finish := func() {
		application.Get().Event.Emit(uploadProgressEvent, UploadProgress{
			Uploaded: prog.total, Total: prog.total, Done: true,
		})
	}
	for _, p := range localPaths {
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		if info.IsDir() {
			// 保留文件夹自身名称：原样拷贝到 remoteDir/<dirName>/ 下，不铺平
			dirName := filepath.Base(p)
			werr := filepath.Walk(p, func(fp string, fi os.FileInfo, werr error) error {
				if werr != nil {
					return werr
				}
				rel, rerr := filepath.Rel(p, fp)
				if rerr != nil {
					return rerr
				}
				target := path.Join(remoteDir, dirName, filepath.ToSlash(rel))
				if fi.IsDir() {
					return sc.MkdirAll(target)
				}
				_, e := uploadFileSc(sc, fp, path.Dir(target), convertSet[fp], prog)
				return e
			})
			if werr != nil {
				finish()
				return werr
			}
		} else {
			if _, e := uploadFileSc(sc, p, remoteDir, convertSet[p], prog); e != nil {
				finish()
				return e
			}
		}
	}
	finish()
	return nil
}

// UploadPathsAs 按冲突策略上传。mode 为 overwrite（删掉同名项再写入）或 rename（自动加「 1」「 2」）。
func (s *Files) UploadPathsAs(host string, localPaths []string, remoteDir, mode string) error {
	mode, err := normalizeConflictMode(mode)
	if err != nil {
		return err
	}
	remoteDir = path.Clean(strings.TrimSpace(remoteDir))
	if remoteDir == "" || remoteDir == "." {
		return fmt.Errorf("远程目录为空")
	}
	var total int64
	for _, p := range localPaths {
		_ = filepath.Walk(p, func(_ string, info os.FileInfo, walkErr error) error {
			if walkErr == nil && info != nil && !info.IsDir() {
				total += info.Size()
			}
			return nil
		})
	}
	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return err
	}
	defer sc.Close()

	prog := &progressTracker{total: total}
	finish := func() {
		application.Get().Event.Emit(uploadProgressEvent, UploadProgress{
			Uploaded: prog.total, Total: prog.total, Done: true,
		})
	}
	reserved := map[string]bool{}
	for _, p := range localPaths {
		info, statErr := os.Stat(p)
		if statErr != nil {
			finish()
			return fmt.Errorf("本地文件不存在: %w", statErr)
		}
		destName, replace, nameErr := pickConflictName(filepath.Base(p), mode, reserved, func(name string) bool {
			_, err := sc.Stat(path.Join(remoteDir, name))
			return err == nil
		})
		if nameErr != nil {
			finish()
			return nameErr
		}
		if replace {
			if err := removeRemoteIfPresent(sc, path.Join(remoteDir, destName)); err != nil {
				finish()
				return err
			}
		}
		if info.IsDir() {
			if err := uploadDirAs(sc, p, remoteDir, destName, prog); err != nil {
				finish()
				return err
			}
			continue
		}
		if _, err := uploadFileNamed(sc, p, remoteDir, destName, false, prog); err != nil {
			finish()
			return err
		}
	}
	finish()
	return nil
}

func uploadDirAs(sc *sftp.Client, localDir, remoteDir, destName string, prog *progressTracker) error {
	return filepath.Walk(localDir, func(fp string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, rerr := filepath.Rel(localDir, fp)
		if rerr != nil {
			return rerr
		}
		target := path.Join(remoteDir, destName, filepath.ToSlash(rel))
		if fi.IsDir() {
			return sc.MkdirAll(target)
		}
		_, e := uploadFileNamed(sc, fp, path.Dir(target), path.Base(target), false, prog)
		return e
	})
}

// openSFTP 建立一次 SFTP 会话（复用 sshd.Manager 的 SSH 长连接）。
// 连接池里的 client 可能已经断了：创建失败时丢掉这只，再拨一次。
func openSFTP(mgr *sshd.Manager, host string, resolve func(string) (sshd.ConnectOption, error)) (*sftp.Client, error) {
	opt, err := resolve(host)
	if err != nil {
		return nil, err
	}
	client, err := mgr.GetClient(host, opt)
	if err != nil {
		return nil, fmt.Errorf("连接失败: %w", err)
	}
	sc, err := sftp.NewClient(client)
	if err == nil {
		return sc, nil
	}
	if !sshConnDead(err) {
		return nil, fmt.Errorf("SFTP 会话创建失败: %w", err)
	}
	mgr.DropClient(host, client)
	client, err = mgr.GetClient(host, opt)
	if err != nil {
		return nil, fmt.Errorf("连接失败: %w", err)
	}
	sc, err = sftp.NewClient(client)
	if err != nil {
		return nil, fmt.Errorf("SFTP 会话创建失败: %w", err)
	}
	return sc, nil
}

// sshConnDead 判断是不是「这条 SSH 已经不能用了」，而不是目录不存在这类业务错误。
func sshConnDead(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, net.ErrClosed) {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, kw := range []string{
		"eof",
		"use of closed",
		"connection reset",
		"broken pipe",
		"connection lost",
		"forcibly closed",
		"disconnected",
		"unexpected packet",
	} {
		if strings.Contains(msg, kw) {
			return true
		}
	}
	return false
}

// uploadFileSc 上传单个文件（已建立 SFTP 会话）；normalize 时对非标准文本做内存转换后写
func uploadFileSc(sc *sftp.Client, localPath, remoteDir string, normalize bool, prog *progressTracker) (string, error) {
	return uploadFileNamed(sc, localPath, remoteDir, path.Base(localPath), normalize, prog)
}

// uploadFileNamed 同上，远程文件名用 destName。冲突改名时 destName 已是「名字 1」。
func uploadFileNamed(sc *sftp.Client, localPath, remoteDir, destName string, normalize bool, prog *progressTracker) (string, error) {
	if err := sc.MkdirAll(remoteDir); err != nil {
		return "", fmt.Errorf("创建远程目录失败: %w", err)
	}
	remotePath := path.Join(remoteDir, destName)
	remoteFile, err := sc.Create(remotePath)
	if err != nil {
		return "", fmt.Errorf("创建远程文件失败: %w", err)
	}
	defer remoteFile.Close()

	current := destName

	// normalize 分支：若需要转换，全量读 → 转换 → 一次写出
	if normalize {
		if data, ok, err := tryNormalizeLocal(localPath); err != nil {
			return "", err
		} else if ok {
			if _, err := remoteFile.Write(data); err != nil {
				return "", fmt.Errorf("写入失败: %w", err)
			}
			prog.add(int64(len(data)))
			prog.emit(current)
			return remotePath, nil
		}
		// ok=false：二进制 / 标准 / 超限 → 走流式原样上传
	}

	// 流式分块上传
	localFile, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("打开本地文件失败: %w", err)
	}
	defer localFile.Close()
	buf := make([]byte, uploadChunkSize)
	for {
		n, rerr := localFile.Read(buf)
		if n > 0 {
			if _, werr := remoteFile.Write(buf[:n]); werr != nil {
				return "", fmt.Errorf("写入失败: %w", werr)
			}
			prog.add(int64(n))
			prog.emit(current)
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return "", fmt.Errorf("读取失败: %w", rerr)
		}
	}
	return remotePath, nil
}

// tryNormalizeLocal 尝试读取本地文件并规范为 UTF-8(无BOM)+LF
// 返回 (转换后字节, 是否转换, 错误)
// 非文本 / 标准文件 / 超过 uploadNormalizeLimit 的文件返回 ok=false（调用方原样上传）
func tryNormalizeLocal(localPath string) ([]byte, bool, error) {
	info, err := os.Stat(localPath)
	if err != nil {
		return nil, false, err
	}
	if info.Size() > uploadNormalizeLimit {
		return nil, false, nil // 超大文件不转换
	}
	raw, err := os.ReadFile(localPath)
	if err != nil {
		return nil, false, err
	}
	if !filetext.IsLikelyText(raw) {
		return nil, false, nil // 二进制
	}
	text, enc, derr := filetext.DecodeToUTF8(raw)
	if derr != nil {
		return nil, false, nil
	}
	if !filetext.NeedsNormalize(enc, filetext.DetectLineEnding(raw)) {
		return nil, false, nil // 标准
	}
	return []byte(filetext.NormalizeLinux(text)), true, nil
}
