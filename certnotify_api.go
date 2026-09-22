package main

import (
	"fmt"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/certnotify"
)

// CertNotify 证书到期通知的差额计算与去重游标。检测在 spanel-agent，发送在面板。
type CertNotify App

// Plan 按本次快照和上次还在催的域名，算出今天要发的催办与恢复。
func (s *CertNotify) Plan(host string, snap agentcli.CertCheckSnapshot, nagging []string) certnotify.Result {
	return certnotify.Plan(host, snap, nagging, time.Local)
}

// GetCursor 读取该主机已处理的扫描日和仍在催的域名。
func (s *CertNotify) GetCursor(host string) certnotify.Cursor {
	if s.certNotify == nil {
		return certnotify.Cursor{}
	}
	return s.certNotify.Get(host)
}

// CommitCursor 记下该主机这次扫描日已经处理完。
func (s *CertNotify) CommitCursor(host string, c certnotify.Cursor) error {
	if s.certNotify == nil {
		return fmt.Errorf("证书通知状态未初始化")
	}
	return s.certNotify.Commit(host, c)
}

// RenameCursor 主机改名时把去重游标带走。
func (s *CertNotify) RenameCursor(from, to string) error {
	if s.certNotify == nil {
		return fmt.Errorf("证书通知状态未初始化")
	}
	return s.certNotify.Rename(from, to)
}
