package main

import (
	"fmt"
	"strings"

	"diteng-pannel/internal/groups"
)

// Groups 分组管理服务（本地存储，不修改服务器）
type Groups App

// ============ 分组 ============

// ListGroups 返回全部分组（按 order 排序）
func (s *Groups) ListGroups() []groups.Group {
	if s.groups == nil {
		return []groups.Group{}
	}
	return s.groups.List()
}

// UpsertGroup 创建或更新分组
func (s *Groups) UpsertGroup(g groups.Group) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return s.groups.Upsert(g)
}

// RenameGroup 重命名分组（只改显示名，保留 hosts）
func (s *Groups) RenameGroup(id, newName string) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return s.groups.Rename(id, newName)
}

// DeleteGroup 删除分组
func (s *Groups) DeleteGroup(id string) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return s.groups.Delete(id)
}

// AssignHost 把主机分配到分组；groupID 为空表示移出所有分组（未分组）
func (s *Groups) AssignHost(host, groupID string) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	return s.groups.AssignHost(host, groupID)
}
