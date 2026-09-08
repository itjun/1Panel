package main

import (
	"fmt"

	"diteng-pannel/internal/notifysubs"
)

// NotifySubs 通知订阅（资源告警 / 应用探活 / 企微通道），落盘到本机应用数据目录。
type NotifySubs App

// Get 读取已保存的订阅。FromDisk=false 表示尚未落盘，前端可把 localStorage 迁过来。
func (s *NotifySubs) Get() notifysubs.Data {
	if s.notifySubs == nil {
		return notifysubs.Data{}
	}
	return s.notifySubs.Get()
}

// Set 整份覆盖并落盘。重编译应用后仍在。
func (s *NotifySubs) Set(d notifysubs.Data) error {
	if s.notifySubs == nil {
		return fmt.Errorf("通知订阅未初始化")
	}
	return s.notifySubs.Set(d)
}
