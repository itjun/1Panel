package main

import (
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"diteng-pannel/internal/filetext"
	"diteng-pannel/internal/sshd"

	"github.com/pkg/sftp"
)

// ============ 远程文本预览 / 规范化 / 本地编码检测 ============

const maxTextPreviewBytes = 512 * 1024

// ReadFilePreview（Files 服务）读取远程文本文件：返回编码/换行检测 + UTF-8 内容
// 比 ReadFileText 更完整，供预览抽屉状态栏与「转 Linux 标准」使用
func (s *Files) ReadFilePreview(host, file string) (filetext.Preview, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return filetext.Preview{}, err
	}
	raw, name, err := readRemoteFileBytes(s.sshMgr, host, opt, file, maxTextPreviewBytes)
	if err != nil {
		return filetext.Preview{}, err
	}
	return filetext.BuildPreview(file, name, raw)
}

// NormalizeFileToLinux 将远程文本文件规范为 UTF-8（无 BOM）+ LF
// 写前自动备份为 <file>.bak.YYYYMMDD-HHMMSS
// 成功后返回新的预览结果（needsNormalize=false）
func (s *Files) NormalizeFileToLinux(host, file string) (filetext.Preview, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return filetext.Preview{}, err
	}
	raw, name, err := readRemoteFileBytes(s.sshMgr, host, opt, file, maxTextPreviewBytes)
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
	if err := writeRemoteFileWithBackup(s.sshMgr, host, opt, file, []byte(normalized)); err != nil {
		return filetext.Preview{}, err
	}
	// 再读一遍确认
	raw2, _, err := readRemoteFileBytes(s.sshMgr, host, opt, file, maxTextPreviewBytes)
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

// ============ 上传前本地编码检测 ============

const localCheckMaxBytes = 8 * 1024 * 1024 // 超过 8MB 不检测（大文件通常非脚本，避免内存压力）
const localPreviewRunes = 400              // 预览片段字符数（弹窗展开预览用）

// LocalTextCheck 单个本地文件的编码检测结果（上传前编码检查弹窗用）
type LocalTextCheck struct {
	Path           string `json:"path"`
	RelPath        string `json:"relPath"`        // 相对路径（文件夹上传时展示层级）
	Name           string `json:"name"`
	Encoding       string `json:"encoding"`       // UTF-8 / GBK / GB18030 / UTF-16LE …
	LineEnding     string `json:"lineEnding"`     // LF / CRLF / CR / Mixed
	NeedsNormalize bool   `json:"needsNormalize"` // 非 Linux 标准（非 UTF-8 无 BOM + LF）
	Content        string `json:"content"`        // 原始解码后片段（弹窗预览）
	Normalized     string `json:"normalized"`     // NormalizeLinux 后片段（弹窗预览对比）
	Size           int64  `json:"size"`
}

// CheckLocalPaths 检测本地路径（文件/文件夹混合），返回所有「非 Linux 标准」的文本文件清单
// 二进制 / 标准 UTF-8+LF / 超大文件 均跳过（不需用户决策）
func (s *Files) CheckLocalPaths(localPaths []string) ([]LocalTextCheck, error) {
	out := make([]LocalTextCheck, 0)
	for _, p := range localPaths {
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		if info.IsDir() {
			_ = filepath.Walk(p, func(fp string, fi os.FileInfo, err error) error {
				if err != nil || fi.IsDir() {
					return nil
				}
				rel, _ := filepath.Rel(p, fp)
				if c, ok := checkOneLocalFile(fp, rel); ok {
					out = append(out, c)
				}
				return nil
			})
		} else if c, ok := checkOneLocalFile(p, filepath.Base(p)); ok {
			out = append(out, c)
		}
	}
	return out, nil
}

// checkOneLocalFile 检测单个本地文件；仅在「文本且非标准」时返回结果
func checkOneLocalFile(fp, rel string) (LocalTextCheck, bool) {
	info, err := os.Stat(fp)
	if err != nil || info.Size() == 0 || info.Size() > localCheckMaxBytes {
		return LocalTextCheck{}, false
	}
	raw, err := os.ReadFile(fp)
	if err != nil {
		return LocalTextCheck{}, false
	}
	if !filetext.IsLikelyText(raw) {
		return LocalTextCheck{}, false // 二进制，跳过
	}
	text, enc, err := filetext.DecodeToUTF8(raw)
	if err != nil {
		return LocalTextCheck{}, false
	}
	le := filetext.DetectLineEnding(raw)
	if !filetext.NeedsNormalize(enc, le) {
		return LocalTextCheck{}, false // 标准 UTF-8+LF，跳过
	}
	return LocalTextCheck{
		Path:           fp,
		RelPath:        rel,
		Name:           filepath.Base(fp),
		Encoding:       enc,
		LineEnding:     le,
		NeedsNormalize: true,
		Content:        truncateRunes(text, localPreviewRunes),
		Normalized:     truncateRunes(filetext.NormalizeLinux(text), localPreviewRunes),
		Size:           info.Size(),
	}, true
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
