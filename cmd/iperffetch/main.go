// iperffetch 按 internal/iperfres/SHA256SUMS 下载 userdocs/iperf3-static 固定版本到 internal/iperfres/bin；
// 已存在且校验一致的文件跳过，校验失败直接退出非零，不留半截文件。
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"diteng-pannel/internal/iperfres"
)

const (
	binDir  = "internal/iperfres/bin"
	baseURL = "https://github.com/userdocs/iperf3-static/releases/download/"
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
	for _, a := range iperfres.Assets() {
		dst := filepath.Join(binDir, a.Name)
		if sum, err := fileSHA(dst); err == nil && sum == a.SHA256 {
			continue
		}
		url := baseURL + iperfres.Version + "/" + a.Name
		fmt.Println("==> 下载", url)
		if err := download(url, dst, a.SHA256); err != nil {
			return fmt.Errorf("%s: %w", a.Name, err)
		}
	}
	fmt.Printf("iperf3 %s 内置产物就绪（%d 个）\n", iperfres.Version, len(iperfres.Assets()))
	return nil
}

func fileSHA(path string) (string, error) {
	f, err := os.Open(path)
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
	return os.Rename(tmp, dst)
}
