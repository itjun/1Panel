// Package iperfres 内置 iperf3 静态二进制，供网络测速上传到目标主机或在本机运行。
// Linux/macOS 产物来自 userdocs/iperf3-static（单文件）；Windows 产物来自 ar51an/iperf3-win-builds
// （Cygwin 构建，iperf3.exe 须与 cygwin1.dll 同目录）。产物由 `task iperf:fetch`（go run ./cmd/iperffetch）
// 按 SHA256SUMS 下载校验到 bin/（gitignore），未下载时目录内仅占位文件，接口返回明确错误提示先下载。
package iperfres

import (
	"bufio"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"path"
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

// Asset 一个内置产物：Name 为 bin/ 下的相对路径（win64/ 组为 zip 解压成员）
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

// assetName 把 (GOOS, uname -m / GOARCH) 归一到 bin/ 下的产物路径；目录型产物（win64/）返回入口文件
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
	case "windows":
		switch arch {
		case "x86_64", "amd64", "arm64", "aarch64": // arm64 走 x64 模拟
			return "win64/iperf3.exe", nil
		}
	}
	return "", fmt.Errorf("测速不支持 %s/%s（仅支持 Linux x86_64/aarch64、macOS 与 Windows x64）", goos, arch)
}

// File 一个待落盘的内置文件；Windows 为多文件（exe + dll），须写到同一目录
type File struct {
	Name   string
	Data   []byte
	SHA256 string
}

// Files 按系统与架构返回内置 iperf3 的全部文件；[0] 为可执行入口（目录型产物的同目录其余文件排在其后）
func Files(goos, arch string) ([]File, error) {
	name, err := assetName(goos, arch)
	if err != nil {
		return nil, err
	}
	primary, err := readFile("bin/" + name)
	if err != nil {
		return nil, err
	}
	out := []File{primary}
	if d := path.Dir(name); d != "." {
		ents, err := fs.ReadDir(files, "bin/"+d)
		if err != nil {
			return nil, err
		}
		for _, e := range ents {
			if e.IsDir() || e.Name() == primary.Name || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			f, err := readFile("bin/" + d + "/" + e.Name())
			if err != nil {
				return nil, err
			}
			out = append(out, f)
		}
	}
	return out, nil
}

// Binary 单文件产物的便捷读取（上传远端 POSIX 主机用）；Windows 为多文件产物，只能本机使用
func Binary(goos, arch string) ([]byte, string, error) {
	fl, err := Files(goos, arch)
	if err != nil {
		return nil, "", err
	}
	if len(fl) != 1 {
		return nil, "", fmt.Errorf("%s/%s 为多文件产物，仅支持本机运行", goos, arch)
	}
	return fl[0].Data, fl[0].SHA256, nil
}

func readFile(p string) (File, error) {
	b, err := files.ReadFile(p)
	if err != nil {
		return File{}, fmt.Errorf("内置 iperf3 未下载：%s 不存在，请先运行 task iperf:fetch", path.Base(p))
	}
	sum := sha256.Sum256(b)
	return File{Name: path.Base(p), Data: b, SHA256: hex.EncodeToString(sum[:])}, nil
}
