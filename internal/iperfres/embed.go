// Package iperfres 内置 iperf3 静态二进制（userdocs/iperf3-static），供网络测速上传到目标主机或在本机运行。
// 产物由 `task iperf:fetch`（go run ./cmd/iperffetch）按 SHA256SUMS 下载校验到 bin/（gitignore），
// 未下载时目录内仅占位文件，接口返回明确错误提示先下载。
package iperfres

import (
	"bufio"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"strings"
)

//go:embed VERSION
var versionFile string

//go:embed SHA256SUMS
var sumsFile string

// Version 内置 iperf3 版本（需 >= 3.17 才支持 --json-stream）
var Version = strings.TrimSpace(versionFile)

//go:embed all:bin
var files embed.FS

// Asset 一个内置产物：Name 为上游发布文件名（也是 bin/ 下的文件名）
type Asset struct {
	Name   string
	SHA256 string
}

// Assets 解析 SHA256SUMS（格式同 shasum：`<sha256>  <name>`）
func Assets() []Asset {
	var out []Asset
	sc := bufio.NewScanner(strings.NewReader(sumsFile))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) != 2 || strings.HasPrefix(f[0], "#") {
			continue
		}
		out = append(out, Asset{Name: f[1], SHA256: f[0]})
	}
	return out
}

// assetName 把 (GOOS, uname -m / GOARCH) 归一到上游文件名
func assetName(goos, arch string) (string, error) {
	switch goos {
	case "linux":
		switch arch {
		case "x86_64", "amd64":
			return "iperf3-amd64", nil
		case "aarch64", "arm64":
			return "iperf3-arm64v8", nil
		}
	case "darwin":
		switch arch {
		case "arm64", "aarch64":
			return "iperf3-arm64-osx-14", nil
		case "x86_64", "amd64":
			return "iperf3-amd64-osx-15", nil
		}
	}
	return "", fmt.Errorf("测速不支持 %s/%s（仅支持 Linux x86_64/aarch64 与 macOS）", goos, arch)
}

// Binary 按系统与架构返回内置 iperf3 与 sha256
func Binary(goos, arch string) ([]byte, string, error) {
	name, err := assetName(goos, arch)
	if err != nil {
		return nil, "", err
	}
	b, err := files.ReadFile("bin/" + name)
	if err != nil {
		return nil, "", fmt.Errorf("内置 iperf3 未下载：%s 不存在，请先运行 task iperf:fetch", name)
	}
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:]), nil
}
