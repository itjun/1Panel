package main

import (
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"

	"diteng-pannel/internal/filetext"
	"diteng-pannel/internal/sshd"

	"github.com/pkg/sftp"
)

const maxTextPreviewBytes = 512 * 1024

// ReadFilePreview 读取远程文本文件：返回编码/换行检测 + UTF-8 内容
// 比 ReadFileText 更完整，供预览抽屉状态栏与「转 Linux 标准」使用
func (a *App) ReadFilePreview(host, file string) (filetext.Preview, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return filetext.Preview{}, err
	}
	raw, name, err := readRemoteFileBytes(a.sshMgr, host, opt, file, maxTextPreviewBytes)
	if err != nil {
		return filetext.Preview{}, err
	}
	return filetext.BuildPreview(file, name, raw)
}

// NormalizeFileToLinux 将远程文本文件规范为 UTF-8（无 BOM）+ LF
// 写前自动备份为 <file>.bak.YYYYMMDD-HHMMSS
// 成功后返回新的预览结果（needsNormalize=false）
func (a *App) NormalizeFileToLinux(host, file string) (filetext.Preview, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return filetext.Preview{}, err
	}
	raw, name, err := readRemoteFileBytes(a.sshMgr, host, opt, file, maxTextPreviewBytes)
	if err != nil {
		return filetext.Preview{}, err
	}
	prev, err := filetext.BuildPreview(file, name, raw)
	if err != nil {
		return filetext.Preview{}, err
	}
	if !prev.NeedsNormalize {
		return prev, nil
	}
	normalized := filetext.NormalizeLinux(prev.Content)
	if err := writeRemoteFileWithBackup(a.sshMgr, host, opt, file, []byte(normalized)); err != nil {
		return filetext.Preview{}, err
	}
	// 再读一遍确认
	raw2, _, err := readRemoteFileBytes(a.sshMgr, host, opt, file, maxTextPreviewBytes)
	if err != nil {
		// 写成功但回读失败：仍返回规范化后的预览
		return filetext.Preview{
			Path:           file,
			Name:           name,
			Content:        normalized,
			Encoding:       "UTF-8",
			LineEnding:     filetext.DetectLineEnding([]byte(normalized)),
			NeedsNormalize: false,
			Size:           len(normalized),
		}, nil
	}
	return filetext.BuildPreview(file, name, raw2)
}

func readRemoteFileBytes(mgr *sshd.Manager, host string, opt sshd.ConnectOption, file string, maxSize int) ([]byte, string, error) {
	if file == "" || !strings.HasPrefix(file, "/") {
		return nil, "", fmt.Errorf("无效路径: %s", file)
	}
	client, err := mgr.GetClient(host, opt)
	if err != nil {
		return nil, "", fmt.Errorf("连接失败: %w", err)
	}
	sc, err := sftp.NewClient(client)
	if err != nil {
		return nil, "", fmt.Errorf("SFTP 失败: %w", err)
	}
	defer sc.Close()

	st, err := sc.Stat(file)
	if err != nil {
		return nil, "", fmt.Errorf("无法访问文件: %w", err)
	}
	if st.IsDir() {
		return nil, "", fmt.Errorf("不是普通文件: %s", file)
	}
	f, err := sc.Open(file)
	if err != nil {
		return nil, "", fmt.Errorf("打开失败: %w", err)
	}
	defer f.Close()

	limited := io.LimitReader(f, int64(maxSize)+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, "", fmt.Errorf("读取失败: %w", err)
	}
	if len(raw) > maxSize {
		raw = raw[:maxSize]
	}
	return raw, path.Base(file), nil
}

func writeRemoteFileWithBackup(mgr *sshd.Manager, host string, opt sshd.ConnectOption, file string, data []byte) error {
	client, err := mgr.GetClient(host, opt)
	if err != nil {
		return fmt.Errorf("连接失败: %w", err)
	}
	sc, err := sftp.NewClient(client)
	if err != nil {
		return fmt.Errorf("SFTP 失败: %w", err)
	}
	defer sc.Close()

	// 备份
	bak := fmt.Sprintf("%s.bak.%s", file, time.Now().Format("20060102-150405"))
	src, err := sc.Open(file)
	if err != nil {
		return fmt.Errorf("打开源文件失败: %w", err)
	}
	dst, err := sc.Create(bak)
	if err != nil {
		_ = src.Close()
		return fmt.Errorf("创建备份失败: %w", err)
	}
	_, copyErr := io.Copy(dst, src)
	_ = src.Close()
	_ = dst.Close()
	if copyErr != nil {
		return fmt.Errorf("备份写入失败: %w", copyErr)
	}

	// 覆盖写：截断后写入
	wf, err := sc.OpenFile(file, os.O_WRONLY|os.O_TRUNC|os.O_CREATE)
	if err != nil {
		return fmt.Errorf("打开写入失败: %w", err)
	}
	defer wf.Close()
	if _, err := wf.Write(data); err != nil {
		return fmt.Errorf("写入失败: %w", err)
	}
	return nil
}
