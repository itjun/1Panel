package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const maxManifestBytes = 1 << 20

// Client 访问更新源并管理本地缓存目录。
type Client struct {
	BaseURL   string
	PublicKey ed25519.PublicKey
	// Dir 本地目录：缓存清单、存放下载中的安装包。
	Dir  string
	HTTP *http.Client
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			ResponseHeaderTimeout: 30 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			IdleConnTimeout:       60 * time.Second,
		},
	}
}

func (c *Client) url(name string) string {
	return strings.TrimRight(c.BaseURL, "/") + "/" + name
}

// Fetch 拉取清单与签名，验签通过后写入本地缓存。
func (c *Client) Fetch(ctx context.Context) (*Manifest, error) {
	if strings.TrimSpace(c.BaseURL) == "" {
		return nil, errors.New("未配置更新源")
	}
	bust := "?t=" + strconv.FormatInt(time.Now().Unix(), 10)
	data, err := c.get(ctx, c.url(ManifestName)+bust)
	if err != nil {
		return nil, err
	}
	sig, err := c.get(ctx, c.url(SignatureName)+bust)
	if err != nil {
		return nil, err
	}
	m, err := ParseManifest(data, sig, c.PublicKey)
	if err != nil {
		return nil, err
	}
	c.saveCache(data, sig)
	return m, nil
}

// LoadCached 读取上次验签通过的清单（断网时用于继续执行强制更新拦截）。
func (c *Client) LoadCached() (*Manifest, error) {
	if c.Dir == "" {
		return nil, os.ErrNotExist
	}
	data, err := os.ReadFile(filepath.Join(c.Dir, ManifestName))
	if err != nil {
		return nil, err
	}
	sig, err := os.ReadFile(filepath.Join(c.Dir, SignatureName))
	if err != nil {
		return nil, err
	}
	return ParseManifest(data, sig, c.PublicKey)
}

func (c *Client) saveCache(data, sig []byte) {
	if c.Dir == "" {
		return
	}
	if err := os.MkdirAll(c.Dir, 0o755); err != nil {
		return
	}
	_ = writeFileAtomic(filepath.Join(c.Dir, ManifestName), data)
	_ = writeFileAtomic(filepath.Join(c.Dir, SignatureName), sig)
}

func (c *Client) get(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接更新源失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("更新源返回 HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxManifestBytes+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxManifestBytes {
		return nil, errors.New("清单过大")
	}
	return b, nil
}

// Progress 下载进度回调；total<=0 表示未知。
type Progress func(done, total int64)

// Download 下载安装包到 Dir/download，校验大小与 sha256 后返回本地路径。
// 已存在且校验一致的文件直接复用。
func (c *Client) Download(ctx context.Context, a Asset, progress Progress) (string, error) {
	if c.Dir == "" {
		return "", errors.New("未设置下载目录")
	}
	name := assetFileName(a)
	if name == "" {
		return "", errors.New("安装包文件名非法")
	}
	dir := filepath.Join(c.Dir, "download")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	final := filepath.Join(dir, name)
	if sum, size, err := hashFile(final); err == nil && strings.EqualFold(sum, a.SHA256) {
		if progress != nil {
			progress(size, size)
		}
		return final, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("下载失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载失败：HTTP %d", resp.StatusCode)
	}
	total := a.Size
	if total <= 0 {
		total = resp.ContentLength
	}

	part := final + ".part"
	f, err := os.Create(part)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	pr := &progressReader{r: resp.Body, total: total, fn: progress}
	n, copyErr := io.Copy(io.MultiWriter(f, h), pr)
	closeErr := f.Close()
	pr.report(true)
	if copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		_ = os.Remove(part)
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", fmt.Errorf("下载中断：%w", copyErr)
	}
	if a.Size > 0 && n != a.Size {
		_ = os.Remove(part)
		return "", fmt.Errorf("安装包大小不符：期望 %d，实际 %d", a.Size, n)
	}
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, a.SHA256) {
		_ = os.Remove(part)
		return "", errors.New("安装包校验失败（sha256 不匹配）")
	}
	if err := os.Rename(part, final); err != nil {
		return "", err
	}
	return final, nil
}

// assetFileName 取安装包文件名，只保留最后一段，防止路径穿越。
func assetFileName(a Asset) string {
	name := a.Name
	if name == "" {
		if u, err := url.Parse(a.URL); err == nil {
			name = path.Base(u.Path)
		}
	}
	name = filepath.Base(filepath.Clean("/" + name))
	if name == "/" || name == "." || name == "" || strings.HasPrefix(name, ".") {
		return ""
	}
	return name
}

type progressReader struct {
	r     io.Reader
	total int64
	done  int64
	last  time.Time
	fn    Progress
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.done += int64(n)
	p.report(false)
	return n, err
}

func (p *progressReader) report(force bool) {
	if p.fn == nil {
		return
	}
	if !force && time.Since(p.last) < 150*time.Millisecond {
		return
	}
	p.last = time.Now()
	p.fn(p.done, p.total)
}

func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func writeFileAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// PruneDownloads 删除下载目录中除 keep 之外的旧安装包。
func (c *Client) PruneDownloads(keep string) {
	if c.Dir == "" {
		return
	}
	dir := filepath.Join(c.Dir, "download")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.Name() == keep {
			continue
		}
		_ = os.RemoveAll(filepath.Join(dir, e.Name()))
	}
}
