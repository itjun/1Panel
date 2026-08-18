package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/hosticon"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
	"diteng-pannel/internal/terminal"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是 Wails 绑定的核心对象
// 所有暴露给前端的方法都挂在它身上（按域拆分见 app_hosts.go / app_monitor.go /
// app_terminal.go / app_menu.go / group_overview.go / upload.go / host_icon.go 等）
type App struct {
	ctx context.Context

	sshMgr    *sshd.Manager
	collector *monitor.Collector
	groups    *groups.Store
	hostIcons *hosticon.Store
	termMgr   *terminal.Manager
}

func NewApp() *App {
	sshMgr := sshd.NewManager()
	return &App{
		sshMgr:  sshMgr,
		termMgr: terminal.NewManager(sshMgr),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.termMgr.Init(ctx)

	// 按主屏分辨率计算 16:10 的窗口尺寸：高度取屏幕的 80%，过宽时按屏幕宽度的 90% 反推
	if screens, err := runtime.ScreenGetAll(ctx); err == nil {
		for _, s := range screens {
			if !s.IsPrimary {
				continue
			}
			screenW, screenH := s.Size.Width, s.Size.Height
			h := screenH * 8 / 10
			w := h * 16 / 10
			if w > screenW*9/10 {
				w = screenW * 9 / 10
				h = w * 10 / 16
			}
			runtime.WindowSetSize(ctx, w, h)
			runtime.WindowCenter(ctx)
			break
		}
	}

	store, err := groups.NewStore("ServerPanel")
	if err != nil {
		runtime.LogErrorf(ctx, "初始化分组存储失败: %v", err)
	} else {
		a.groups = store
	}
	if hi, err := hosticon.NewStore("ServerPanel"); err != nil {
		runtime.LogErrorf(ctx, "初始化主机图标存储失败: %v", err)
	} else {
		a.hostIcons = hi
	}
	a.collector = monitor.NewCollector(a.sshMgr)
}

func (a *App) shutdown(_ context.Context) {
	a.sshMgr.CloseAll()
	a.termMgr.CloseAll()
}

// ============ 分组 ============

func (a *App) ListGroups() []groups.Group {
	if a.groups == nil {
		return []groups.Group{}
	}
	return a.groups.List()
}

func (a *App) UpsertGroup(g groups.Group) error {
	if a.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return a.groups.Upsert(g)
}

// RenameGroup 重命名分组（只改显示名，保留 hosts）
func (a *App) RenameGroup(id, newName string) error {
	if a.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return a.groups.Rename(id, newName)
}

func (a *App) DeleteGroup(id string) error {
	if a.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	return a.groups.Delete(id)
}

func (a *App) AssignHost(host, groupID string) error {
	if a.groups == nil {
		return fmt.Errorf("分组存储未初始化")
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return fmt.Errorf("主机名不能为空")
	}
	return a.groups.AssignHost(host, groupID)
}

// SetTrafficLightsHidden 隐藏/恢复 macOS 窗口红绿灯按钮
// 供前端卡片最大化时调用：最大化期间隐藏，退出时恢复
func (a *App) SetTrafficLightsHidden(hidden bool) {
	setTrafficLightsHidden(hidden)
}

// ============ 辅助 ============

// connectOptionFor 根据 host 名称从 ssh config 里查找对应连接参数
func (a *App) connectOptionFor(host string) (sshd.ConnectOption, error) {
	hosts, err := sshconfig.Parse()
	if err != nil {
		return sshd.ConnectOption{}, err
	}
	for _, h := range hosts {
		if h.Name == host {
			return sshd.ConnectOption{
				Host:         h.Name,
				HostName:     h.HostName,
				User:         h.User,
				Port:         h.Port,
				IdentityFile: h.IdentityFile,
			}, nil
		}
	}
	return sshd.ConnectOption{}, fmt.Errorf("在 ~/.ssh/config 中未找到 Host: %s", host)
}

// 按 grilling 时定下的策略：
//   - 错误处理静默失败 + 红色徽章 + 断线 30s 才重试
//   - 这里返回时间常量供前端使用
const RetryInterval = 30 * time.Second
