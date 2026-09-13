package main

import "diteng-pannel/internal/localsys"

// LocalSys 本机系统信息（macOS；不经 SSH）。
type LocalSys App

func (s *LocalSys) Overview() (*localsys.Overview, error) {
	return localsys.CollectOverview()
}

func (s *LocalSys) Network() (*localsys.NetworkSnapshot, error) {
	return localsys.CollectNetwork()
}

func (s *LocalSys) Packages() ([]localsys.Package, error) {
	return localsys.CollectPackages()
}

func (s *LocalSys) Nginx() (*localsys.NginxInfo, error) {
	return localsys.CollectNginx()
}

func (s *LocalSys) NginxRead(path string) (string, error) {
	return localsys.NginxRead(path)
}

func (s *LocalSys) Hosts() (*localsys.HostsInfo, error) {
	return localsys.CollectHosts()
}

func (s *LocalSys) StorageScanStart() (*localsys.StorageStatus, error) {
	return localsys.StorageScanStart()
}

func (s *LocalSys) StorageStatus() *localsys.StorageStatus {
	return localsys.StorageStatusSnapshot()
}

func (s *LocalSys) StorageTree(path string) (*localsys.StorageNode, error) {
	return localsys.StorageTree(path)
}

func (s *LocalSys) StorageApps() ([]localsys.StorageApp, error) {
	return localsys.StorageApps()
}

func (s *LocalSys) StorageLargeFiles() ([]localsys.StorageFile, error) {
	return localsys.StorageLargeFiles()
}

func (s *LocalSys) StorageReveal(path string) error {
	return localsys.StorageReveal(path)
}

func (s *LocalSys) StorageOpenPrivacy() error {
	return localsys.StorageOpenPrivacy()
}

func (s *LocalSys) SystemReport(force bool) (*localsys.SystemReport, error) {
	return localsys.CollectSystemReport(force)
}
