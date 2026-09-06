package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/hosticon"
	"diteng-pannel/internal/sshconfig"
)

// Backup 主机配置备份服务：聚合 ssh config / 分组 / 主机图标为单个 JSON 文件，支持导出与恢复
type Backup App

// backupVersion 当前备份文件格式版本
const backupVersion = 1

// BackupData 备份文件内容：主机列表 + 分组 + 主机图标记录
// 注意：SSH 私钥不在备份内，换机恢复需另行保管 ~/.ssh/id_ed25519
type BackupData struct {
	Version    int                    `json:"version"`
	ExportedAt int64                  `json:"exportedAt"`
	Hosts      []sshconfig.HostConfig `json:"hosts"`
	Groups     []groups.Group         `json:"groups"`
	Icons      []hosticon.Record      `json:"icons"`
}

// ImportResult 导入结果统计
type ImportResult struct {
	Added       []string `json:"added"`       // 新增的主机别名
	Overwritten []string `json:"overwritten"` // 覆盖的主机别名
	Skipped     []string `json:"skipped"`     // 跳过的已存在主机
	Groups      int      `json:"groups"`      // 导入/合并的分组数
	Icons       int      `json:"icons"`       // 写入的图标记录数
}

// ExportBackup 导出主机配置到 dir 下的日期文件夹（如 dir/2026-08-20/serverpanel-backup.json）
// 同名日期文件夹已存在时整体覆盖（同一天重复导出会覆盖当天旧备份）
// 成功返回摘要文案
func (s *Backup) ExportBackup(dir string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return "", fmt.Errorf("导出目录不能为空")
	}

	hosts, err := listNonGitHosts()
	if err != nil {
		return "", fmt.Errorf("读取 ssh config 失败: %w", err)
	}
	if s.hostMeta != nil {
		for i := range hosts {
			hosts[i].Note = s.hostMeta.Get(hosts[i].Name)
		}
	}
	hostSet := make(map[string]bool, len(hosts))
	for _, h := range hosts {
		hostSet[h.Name] = true
	}

	// 图标只导出对应主机的记录
	var icons []hosticon.Record
	if s.hostIcons != nil {
		for _, r := range s.hostIcons.List() {
			if hostSet[r.Host] {
				icons = append(icons, r)
			}
		}
	}

	var groupList []groups.Group
	if s.groups != nil {
		groupList = s.groups.List()
	}

	// now 只取一次，保证 ExportedAt 与文件夹日期同源（跨午夜不出现偏差）
	now := time.Now()
	data := BackupData{
		Version:    backupVersion,
		ExportedAt: now.Unix(),
		Hosts:      hosts,
		Groups:     groupList,
		Icons:      icons,
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("序列化备份失败: %w", err)
	}

	// RemoveAll 对不存在的路径返回 nil，无需先判断
	backupDir := filepath.Join(dir, now.Format("2006-01-02"))
	if err := os.RemoveAll(backupDir); err != nil {
		return "", fmt.Errorf("覆盖旧备份文件夹失败: %w", err)
	}
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		return "", fmt.Errorf("创建备份文件夹失败: %w", err)
	}
	path := filepath.Join(backupDir, "serverpanel-backup.json")
	if err := os.WriteFile(path, b, 0600); err != nil {
		return "", fmt.Errorf("写入备份文件失败: %w", err)
	}
	return fmt.Sprintf("已导出 %d 台主机、%d 个分组到 %s", len(hosts), len(groupList), backupDir), nil
}

// ReadBackup 读取并校验备份文件（导入预览用）
func (s *Backup) ReadBackup(path string) (*BackupData, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("备份文件路径不能为空")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取备份文件失败: %w", err)
	}
	var data BackupData
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, fmt.Errorf("解析备份文件失败（不是有效的备份文件）: %w", err)
	}
	if data.Version != backupVersion {
		return nil, fmt.Errorf("备份文件版本不兼容: %d（当前支持 %d）", data.Version, backupVersion)
	}
	return &data, nil
}

// ImportBackup 从备份文件恢复主机配置
//   - overwrite=false：已存在的主机跳过（保留本地配置）
//   - overwrite=true：已存在的主机先删后写，字段以备份为准
//
// 备份文件可能被手工编辑过：别名与字段值先校验再写入，避免写出畸形 Host 块。
// Git 托管条目（github.com 等）即使在覆盖模式下也不动——导出时本就不含它们。
// 分组：引用的主机若不存在则剔除；本地已有同名或同 ID 分组时合并进去
// （保留本地名称与排序，只并入备份的主机引用），否则按备份新建。
func (s *Backup) ImportBackup(path string, overwrite bool) (*ImportResult, error) {
	data, err := s.ReadBackup(path)
	if err != nil {
		return nil, err
	}

	// 存量别名 -> 本地条目，导入过程中同步更新
	hosts, err := sshconfig.Parse()
	if err != nil {
		return nil, fmt.Errorf("读取 ssh config 失败: %w", err)
	}
	localByName := make(map[string]sshconfig.HostConfig, len(hosts))
	existing := make(map[string]bool, len(hosts))
	for _, h := range hosts {
		localByName[h.Name] = h
		existing[h.Name] = true
	}

	res := &ImportResult{Added: []string{}, Overwritten: []string{}, Skipped: []string{}}
	for _, h := range data.Hosts {
		if h.Name == "" {
			continue
		}
		// 与 AddHost 的入口校验对齐：renderHostBlock 是无转义拼接，
		// 空格/通配符会写出多别名或通配符块，换行可注入额外指令
		if strings.ContainsAny(h.Name, " \t*") {
			return nil, fmt.Errorf("备份中主机别名 %q 含空格或通配符 *，无法导入", h.Name)
		}
		for _, v := range []string{h.Name, h.HostName, h.User, h.Port, h.IdentityFile, h.ProxyJump, h.HostKeyAlgos, h.Note} {
			if strings.ContainsAny(v, "\n\r") {
				return nil, fmt.Errorf("备份中主机 %q 的字段含换行符，无法导入", h.Name)
			}
		}
		note := strings.TrimSpace(h.Note)
		// Note 不写入 ssh config，AppendHost 前清空，导入后再写 host_meta
		h.Note = ""
		if !existing[h.Name] {
			if err := sshconfig.AppendHost(h); err != nil {
				return nil, fmt.Errorf("写入主机 %s 失败: %w", h.Name, err)
			}
			existing[h.Name] = true
			localByName[h.Name] = h
			res.Added = append(res.Added, h.Name)
			if s.hostMeta != nil {
				if err := s.hostMeta.Set(h.Name, note); err != nil {
					return nil, fmt.Errorf("写入主机备注 %s 失败: %w", h.Name, err)
				}
			}
			continue
		}
		if !overwrite || sshconfig.IsGitHost(localByName[h.Name]) {
			res.Skipped = append(res.Skipped, h.Name)
			continue
		}
		// 覆盖走先删后写：UpdateHostFields 只能改 HostName/User，覆盖不了端口/密钥/跳板
		if err := sshconfig.DeleteHost(h.Name); err != nil {
			return nil, fmt.Errorf("删除旧主机 %s 失败: %w", h.Name, err)
		}
		if err := sshconfig.AppendHost(h); err != nil {
			return nil, fmt.Errorf("覆盖主机 %s 失败: %w", h.Name, err)
		}
		// 关旧连接，下次用备份里的参数重连
		s.sshMgr.Close(h.Name)
		res.Overwritten = append(res.Overwritten, h.Name)
		if s.hostMeta != nil {
			if err := s.hostMeta.Set(h.Name, note); err != nil {
				return nil, fmt.Errorf("写入主机备注 %s 失败: %w", h.Name, err)
			}
		}
	}

	if s.groups != nil {
		current := s.groups.List()
		for _, g := range data.Groups {
			if g.ID == "" || strings.TrimSpace(g.Name) == "" {
				continue
			}
			// 分组引用剔除不存在的主机，避免悬空引用
			keep := make([]string, 0, len(g.Hosts))
			for _, h := range g.Hosts {
				if existing[h] {
					keep = append(keep, h)
				}
			}
			// 目标分组先按名字找，再按 ID 找（本地导入后改过名的情况）；
			// 找到即合并——保留本地名称与排序，避免重复导入回滚用户的改名
			target := findGroupByName(current, g.Name)
			if target == nil {
				target = findGroupByID(current, g.ID)
			}
			if target != nil {
				merged := append([]string{}, target.Hosts...)
				for _, h := range keep {
					if !containsStr(merged, h) {
						merged = append(merged, h)
					}
				}
				if err := s.groups.Upsert(groups.Group{
					ID:         target.ID,
					Name:       target.Name,
					BoardTitle: target.BoardTitle, // 合并保留本地看板标题
					Order:      target.Order,
					Hosts:      merged,
				}); err != nil {
					return nil, fmt.Errorf("合并分组 %s 失败: %w", g.Name, err)
				}
			} else {
				if err := s.groups.Upsert(groups.Group{
					ID:         g.ID,
					Name:       g.Name,
					BoardTitle: g.BoardTitle,
					Order:      g.Order,
					Hosts:      keep,
				}); err != nil {
					return nil, fmt.Errorf("导入分组 %s 失败: %w", g.Name, err)
				}
			}
			res.Groups++
		}
	}

	// 图标只写新增/覆盖的主机，跳过的保留本地记录
	if s.hostIcons != nil {
		for _, r := range data.Icons {
			if r.OSRelease == "" {
				continue
			}
			if !containsStr(res.Added, r.Host) && !containsStr(res.Overwritten, r.Host) {
				continue
			}
			if err := s.hostIcons.Put(r.Host, r.OSRelease); err != nil {
				return nil, fmt.Errorf("写入主机图标 %s 失败: %w", r.Host, err)
			}
			res.Icons++
		}
	}

	return res, nil
}

func findGroupByName(list []groups.Group, name string) *groups.Group {
	for i := range list {
		if list[i].Name == name {
			return &list[i]
		}
	}
	return nil
}

func findGroupByID(list []groups.Group, id string) *groups.Group {
	for i := range list {
		if list[i].ID == id {
			return &list[i]
		}
	}
	return nil
}

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
