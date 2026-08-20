// Package agentres 内置 spanel-agent 多架构二进制，供面板向目标主机一键安装/更新。
// 产物由 `task agent:build` 交叉编译到 bin/ 目录（gitignore），开发期未构建时
// 目录内仅占位文件，接口返回明确错误提示先构建。
package agentres

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
)

// AgentVersion 内置 agent 的版本号；构建时由 ldflags 注入（与面板版本一致）
var AgentVersion = "dev"

// all: 前缀确保包含以点开头的占位文件，未构建产物时包也能编译
//
//go:embed all:bin
var files embed.FS

// archFile 把 uname -m / GOARCH 两种写法归一到产物文件名
func archFile(arch string) (string, error) {
	switch arch {
	case "x86_64", "amd64":
		return "bin/spanel-agent-linux-amd64", nil
	case "aarch64", "arm64":
		return "bin/spanel-agent-linux-arm64", nil
	}
	return "", fmt.Errorf("不支持的架构: %s（仅支持 x86_64/aarch64）", arch)
}

// Binary 按架构返回内置 agent 二进制与 sha256
func Binary(arch string) ([]byte, string, error) {
	name, err := archFile(arch)
	if err != nil {
		return nil, "", err
	}
	b, err := files.ReadFile(name)
	if err != nil {
		return nil, "", fmt.Errorf("内置 agent 未构建：%s 不存在，请先运行 task agent:build", name)
	}
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:]), nil
}

// HasBinary 是否已内置该架构产物（前端显示「可安装」前判断）
func HasBinary(arch string) bool {
	name, err := archFile(arch)
	if err != nil {
		return false
	}
	_, err = fs.ReadFile(files, name)
	return err == nil
}

// SupportedArch 目标机 uname -m 是否受支持
func SupportedArch(arch string) bool {
	_, err := archFile(arch)
	return err == nil
}
