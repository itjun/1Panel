// iperffetch 按 internal/iperfres/SHA256SUMS 下载内置 iperf3 到 internal/iperfres/bin：
// Linux/macOS 单文件来自 userdocs/iperf3-static；win64/ 组来自 ar51an/iperf3-win-builds 的 zip（校验后解压）。
// 已存在且校验一致的文件跳过，校验失败直接退出非零，不留半截文件。
package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"diteng-pannel/internal/iperfres"
)

const (
	binDir  = "internal/iperfres/bin"
	baseURL = "https://github.com/userdocs/iperf3-static/releases/download/"

	// win64 组整包下载；zip 哈希钉死 3.22，升级 VERSION 时须同步更新
	winBaseURL = "https://github.com/ar51an/iperf3-win-builds/releases/download/"
	winZipSHA  = "c9feabb3d721039508ccb81f74c2ada3ae11b9e75d33d24510573c2aa21da420"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "iperf:fetch 失败:", err)
		os.Exit(1)
	}
}

func run() error {
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return err
	}
	var winMembers []iperfres.Asset
	for _, a := range iperfres.Assets() {
		if strings.HasPrefix(a.Name, "win64/") {
			winMembers = append(winMembers, a)
			continue
		}
		if err := fetchDirect(a); err != nil {
			return err
		}
	}
	if len(winMembers) > 0 {
		if err := fetchWin64(winMembers); err != nil {
			return err
		}
	}
	fmt.Printf("iperf3 %s 内置产物就绪（%d 个）\n", iperfres.Version, len(iperfres.Assets()))
	return nil
}

// fetchDirect 下载单文件产物（userdocs 直链）
func fetchDirect(a iperfres.Asset) error {
	dst := filepath.Join(binDir, a.Name)
	if sum, err := fileSHA(dst); err == nil && sum == a.SHA256 {
		return nil
	}
	url := baseURL + iperfres.Version + "/" + a.Name
	fmt.Println("==> 下载", url)
	if err := download(url, dst, a.SHA256); err != nil {
		return fmt.Errorf("%s: %w", a.Name, err)
	}
	return nil
}

// fetchWin64 下载 win64 zip 并解压出 SHA256SUMS 列出的成员
func fetchWin64(members []iperfres.Asset) error {
	allOK := true
	for _, m := range members {
		if sum, err := fileSHA(filepath.Join(binDir, m.Name)); err != nil || sum != m.SHA256 {
			allOK = false
			break
		}
	}
	if allOK {
		return nil
	}
	// zip 不落 bin/，避免被 go:embed 打进程序
	tmpDir, err := os.MkdirTemp("", "iperf3-win64-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)
	zipName := "iperf-" + iperfres.Version + "-win64.zip"
	url := winBaseURL + iperfres.Version + "/" + zipName
	fmt.Println("==> 下载", url)
	zipPath := filepath.Join(tmpDir, zipName)
	if err := download(url, zipPath, winZipSHA); err != nil {
		return fmt.Errorf("%s: %w", zipName, err)
	}
	return extractWin64(zipPath, members)
}

func extractWin64(zipPath string, members []iperfres.Asset) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer zr.Close()
	want := map[string]iperfres.Asset{} // zip 内成员名 -> 清单条目
	for _, m := range members {
		want[path.Base(m.Name)] = m
	}
	found := map[string]bool{}
	for _, f := range zr.File {
		m, ok := want[f.Name]
		if !ok || f.FileInfo().IsDir() {
			continue
		}
		src, err := f.Open()
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Join(binDir, path.Dir(m.Name)), 0o755); err != nil {
			src.Close()
			return err
		}
		tmp := filepath.Join(binDir, m.Name+".tmp")
		h := sha256.New()
		out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
		if err != nil {
			src.Close()
			return err
		}
		_, err = io.Copy(io.MultiWriter(out, h), src)
		cerr := out.Close()
		src.Close()
		if err == nil {
			err = cerr
		}
		if err != nil {
			os.Remove(tmp)
			return err
		}
		if got := hex.EncodeToString(h.Sum(nil)); got != m.SHA256 {
			os.Remove(tmp)
			return fmt.Errorf("%s: sha256 不匹配：期望 %s，实际 %s（清单与 zip 不一致）", m.Name, m.SHA256, got)
		}
		dst := filepath.Join(binDir, m.Name)
		_ = os.Remove(dst)
		if err := os.Rename(tmp, dst); err != nil {
			return err
		}
		fmt.Println("==> 解压", m.Name)
		found[f.Name] = true
	}
	for name := range want {
		if !found[name] {
			return fmt.Errorf("zip 中缺少 %s", name)
		}
	}
	return nil
}

func fileSHA(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func download(url, dst, want string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	tmp := dst + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, h), resp.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != want {
		os.Remove(tmp)
		return fmt.Errorf("sha256 不匹配：期望 %s，实际 %s", want, got)
	}
	_ = os.Remove(dst)
	return os.Rename(tmp, dst)
}
