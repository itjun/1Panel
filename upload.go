package main

import (
	"fmt"
	"io"
	"os"
	"path"

	"diteng-pannel/internal/sshd"

	"github.com/pkg/sftp"
)

// ============ 文件上传（SCP/SFTP） ============

// UploadFile 把本地文件上传到远程主机指定目录
// localPath: 本地文件绝对路径（由 Wails 文件拖拽提供）
// remoteDir: 远程目标目录（绝对路径，会自动创建）
// 返回上传后的完整远程路径
func (a *App) UploadFile(host, localPath, remoteDir string) (string, error) {
	if _, err := os.Stat(localPath); err != nil {
		return "", fmt.Errorf("本地文件不存在: %w", err)
	}
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return uploadViaSFTP(a.sshMgr, host, opt, localPath, remoteDir)
}

// uploadViaSFTP 用 sftp 库上传文件
// 复用 sshd.Manager 的 ssh.Client 长连接，避免重复鉴权
func uploadViaSFTP(mgr *sshd.Manager, host string, opt sshd.ConnectOption, localPath, remoteDir string) (string, error) {
	client, err := mgr.GetClient(host, opt)
	if err != nil {
		return "", fmt.Errorf("连接失败: %w", err)
	}
	sc, err := sftp.NewClient(client)
	if err != nil {
		return "", fmt.Errorf("SFTP 会话创建失败: %w", err)
	}
	defer sc.Close()

	localFile, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("打开本地文件失败: %w", err)
	}
	defer localFile.Close()

	if err := sc.MkdirAll(remoteDir); err != nil {
		return "", fmt.Errorf("创建远程目录失败: %w", err)
	}

	remotePath := path.Join(remoteDir, path.Base(localPath))
	remoteFile, err := sc.Create(remotePath)
	if err != nil {
		return "", fmt.Errorf("创建远程文件失败: %w", err)
	}
	defer remoteFile.Close()

	if _, err := io.Copy(remoteFile, localFile); err != nil {
		return "", fmt.Errorf("写入失败: %w", err)
	}
	return remotePath, nil
}
