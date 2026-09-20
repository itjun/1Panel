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

// UpsertGroup 创建或更新分组（可带 parentId）
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

// SetBoardTitle 设置分组看板中间标题；title 为空表示清空
func (s *Groups) SetBoardTitle(id, title string) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return s.groups.SetBoardTitle(id, title)
}

// MoveGroup 将分组移到新父级；parentID 空表示升为顶层
func (s *Groups) MoveGroup(id, parentID string) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return s.groups.MoveGroup(id, parentID)
}

// ReorderGroups 拖拽排序：按前端给定的同级顺序重排分组 order（依次 0,1,2…）
func (s *Groups) ReorderGroups(parentID string, orderedIDs []string) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return s.groups.ReorderGroups(parentID, orderedIDs)
}

// PreviewDeleteGroup 预览级联删除影响（确认对话框用）
func (s *Groups) PreviewDeleteGroup(id string) (groups.DeleteStats, error) {
	if s.groups == nil {
		return groups.DeleteStats{}, fmt.Errorf("分组存储未初始化")
	}
	return s.groups.PreviewDelete(id)
}

// DeleteGroup 级联删除分组及其子孙
func (s *Groups) DeleteGroup(id string) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return s.groups.Delete(id)
}

// ReorderHosts 拖拽排序：按前端给定顺序重排分组内主机
func (s *Groups) ReorderHosts(groupID string, orderedNames []string) error {
	if s.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return fmt.Errorf("分组 ID 不能为空")
	}
	return s.groups.ReorderHosts(groupID, orderedNames)
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

// SubtreeHostNames 返回分组子树内主机名
func (s *Groups) SubtreeHostNames(id string) []string {
	if s.groups == nil {
		return nil
	}
	return s.groups.SubtreeHostNames(id)
}
