package main

import (
	_ "embed"
	"fmt"

	"github.com/pkg/sftp"
)

// System 系统服务：内置脚本上传 / 窗口控制等
// SetTrafficLightsHidden 见 system.go
type System App

// bootstrapZshScript 是内置的 zsh 环境初始化脚本,编译期嵌入二进制。
// 脚本本体维护在 scripts/bootstrap-zsh.sh,可独立 scp 使用,也供此方法复用。
//
//go:embed scripts/bootstrap-zsh.sh
var bootstrapZshScript []byte

// BootstrapZsh 把内置的 zsh 初始化脚本上传到远程主机 /tmp,返回远程路径。
// 实际执行交给前端终端(实时显示输出),执行完由终端命令清理临时脚本。
func (s *System) BootstrapZsh(host string) (string, error) {
	opt, err := (*App)(s).connectOptionFor(host)
	if err != nil {
		return "", err
	}
	client, err := s.sshMgr.GetClient(host, opt)
	if err != nil {
		return "", fmt.Errorf("连接失败: %w", err)
	}
	const remotePath = "/tmp/.diteng-bootstrap-zsh.sh"
	sc, err := sftp.NewClient(client)
	if err != nil {
		return "", fmt.Errorf("SFTP 会话失败: %w", err)
	}
	defer sc.Close()
	f, err := sc.Create(remotePath)
	if err != nil {
		return "", fmt.Errorf("上传脚本失败: %w", err)
	}
	if _, err := f.Write(bootstrapZshScript); err != nil {
		f.Close()
		return "", fmt.Errorf("写入脚本失败: %w", err)
	}
	f.Close()
	return remotePath, nil
}
