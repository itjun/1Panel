package main

import "diteng-pannel/internal/localapps"

// LocalApps 本机应用监控服务（macOS 本机进程树，不经 SSH）。
type LocalApps App

// Scan 扫描本机应用进程树快照。
func (s *LocalApps) Scan() (*localapps.Snapshot, error) {
	return localapps.Scan()
}

// ProcDetail 查询单个进程详情（含线程）。
func (s *LocalApps) ProcDetail(pid int) (*localapps.ProcNode, error) {
	return localapps.ProcDetail(pid)
}

// Kill 结束本机进程；force 为 true 时发送 SIGKILL。
func (s *LocalApps) Kill(pid int, force bool) error {
	return localapps.Kill(pid, force)
}
