package main

import (
	"context"
	"fmt"
	"time"

	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
	"diteng-pannel/internal/terminal"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是 Wails 绑定的核心对象
// 所有暴露给前端的方法都挂在它身上
type App struct {
	ctx context.Context

	sshMgr     *sshd.Manager
	collector  *monitor.Collector
	groups     *groups.Store
	termMgr    *terminal.Manager
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

	store, err := groups.NewStore("ServerPanel")
	if err != nil {
		runtime.LogErrorf(ctx, "初始化分组存储失败: %v", err)
	} else {
		a.groups = store
	}
	a.collector = monitor.NewCollector(a.sshMgr)
}

func (a *App) shutdown(_ context.Context) {
	a.sshMgr.CloseAll()
	a.termMgr.CloseAll()
}

// ============ SSH 配置 ============

// ListHosts 解析 ~/.ssh/config 返回所有 Host 条目
// 默认过滤掉 Git 托管服务（github.com / gitee.com 等）
// 这些通常不是用户想要管理的"服务器"
func (a *App) ListHosts() ([]sshconfig.HostConfig, error) {
	all, err := sshconfig.Parse()
	if err != nil {
		return nil, err
	}
	out := make([]sshconfig.HostConfig, 0, len(all))
	for _, h := range all {
		if sshconfig.IsGitHost(h) {
			continue
		}
		out = append(out, h)
	}
	return out, nil
}

// ListHostsAll 返回所有 Host 条目（包括 Git 服务）
// 供前端「显示 Git 服务」开关使用
func (a *App) ListHostsAll() ([]sshconfig.HostConfig, error) {
	return sshconfig.Parse()
}

// AddHost 把新主机追加写入 ~/.ssh/config（写入前自动备份）
func (a *App) AddHost(cfg sshconfig.HostConfig) error {
	return sshconfig.AppendHost(cfg)
}

// RenameHost 修改 ~/.ssh/config 里 Host 的别名
// 同时同步 groups.json 里的引用，并关闭旧名的 SSH 连接（避免连接池残留）
func (a *App) RenameHost(oldName, newName string) error {
	// 先校验 newName 不与已有别名重复
	hosts, err := sshconfig.Parse()
	if err != nil {
		return err
	}
	for _, h := range hosts {
		if h.Name == newName {
			return fmt.Errorf("别名 %s 已存在", newName)
		}
	}
	// 改 ssh config
	if err := sshconfig.RenameHost(oldName, newName); err != nil {
		return err
	}
	// 同步分组引用
	if a.groups != nil {
		if err := a.groups.RenameHost(oldName, newName); err != nil {
			runtime.LogWarningf(a.ctx, "同步分组引用失败: %v", err)
		}
	}
	// 关闭旧连接，下次用新别名时重新建立
	a.sshMgr.Close(oldName)
	return nil
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

func (a *App) DeleteGroup(id string) error {
	return a.groups.Delete(id)
}

func (a *App) AssignHost(host, groupID string) error {
	return a.groups.AssignHost(host, groupID)
}

// ============ 监控 ============

// CollectOverview 采集顶层系统指标
func (a *App) CollectOverview(host string) (monitor.Overview, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return monitor.Overview{}, err
	}
	return a.collector.CollectOverview(host, opt)
}

func (a *App) CollectDisks(host string) ([]monitor.DiskInfo, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.CollectDisks(host, opt)
}

func (a *App) CollectProcesses(host string, limit int) ([]monitor.ProcInfo, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.CollectProcesses(host, opt, limit)
}

func (a *App) CollectJava(host string) ([]monitor.ProcInfo, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.CollectJava(host, opt)
}

func (a *App) CollectDocker(host string) (monitor.DockerInfo, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return monitor.DockerInfo{}, err
	}
	return a.collector.CollectDocker(host, opt)
}

func (a *App) CollectServices(host string) ([]monitor.Service, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.CollectServices(host, opt)
}

func (a *App) CollectCrons(host string) ([]monitor.Cron, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.CollectCrons(host, opt)
}

func (a *App) CollectPackages(host string) ([]monitor.AptPackage, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.CollectPackages(host, opt)
}

// ============ 文件浏览（只读） ============

// ListDir 列出远程主机某目录下的内容（只读，不修改）
func (a *App) ListDir(host, dir string) ([]monitor.FileEntry, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.ListDir(host, opt, dir)
}

// ReadFileText 读远程文本文件内容（最多 512KB，只读）
func (a *App) ReadFileText(host, file string) (string, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return a.collector.ReadFileText(host, opt, file, 512*1024)
}

// KillProcess 在远程主机上杀掉指定 PID
func (a *App) KillProcess(host string, pid uint32, force bool) error {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return err
	}
	sig := "TERM"
	if force {
		sig = "KILL"
	}
	cmd := fmt.Sprintf("kill -%s %d 2>&1 || true", sig, pid)
	_, err = a.sshMgr.Run(host, opt, cmd)
	return err
}

// ============ Docker 操作 ============

// DockerAction 对容器执行 start/stop/restart 等操作
func (a *App) DockerAction(host string, action string, container string) (string, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return "", err
	}
	// action 仅允许白名单
	switch action {
	case "start", "stop", "restart", "pause", "unpause":
	default:
		return "", fmt.Errorf("不支持的 docker 操作: %s", action)
	}
	cmd := fmt.Sprintf("docker %s %s 2>&1", action, container)
	out, err := a.sshMgr.Run(host, opt, cmd)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// ============ 终端 ============

// OpenTerminal 打开一个终端会话
// eventName 是前端订阅输出的 Wails 事件名
func (a *App) OpenTerminal(host string, eventName string) (string, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return a.termMgr.Open(host, opt, eventName)
}

func (a *App) WriteTerminal(sessionID string, data string) error {
	return a.termMgr.WriteInput(sessionID, []byte(data))
}

// ResizeTerminal 通知终端会话窗口大小变化（cols/rows）
// 前端 xterm 的 fit.addon 计算出行列数后调用此方法，后端通过 ioctl 同步给 PTY
func (a *App) ResizeTerminal(sessionID string, cols int, rows int) error {
	return a.termMgr.Resize(sessionID, cols, rows)
}

func (a *App) CloseTerminal(sessionID string) error {
	return a.termMgr.Close(sessionID)
}

// ============ ssh-copy-id 等价流程 ============

// CopySSHID 把本机公钥安装到远程主机的 authorized_keys
// 步骤：
//   1. 读 ~/.ssh/id_ed25519.pub（不存在则提示用户先生成）
//   2. 用密码连一次目标主机
//   3. 执行 mkdir -p ~/.ssh && echo "$pubkey" >> authorized_keys && chmod 限制权限
//   4. 关闭连接
//   5. 回写 ~/.ssh/config（追加 Host 块）
func (a *App) CopySSHID(input CopyIDInput) (string, error) {
	if input.PublicKeyFile == "" {
		return "", fmt.Errorf("公钥路径不能为空")
	}
	pub, err := readPublicKey(input.PublicKeyFile)
	if err != nil {
		return "", err
	}
	opt := sshd.ConnectOption{
		Host:     input.Name,
		HostName: input.HostName,
		User:     input.User,
		Port:     input.Port,
		Password: input.Password,
	}
	// 安装公钥
	script := fmt.Sprintf(`mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '%s' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys`, pub)
	if _, err := a.sshMgr.Run(input.Name, opt, script); err != nil {
		return "", fmt.Errorf("安装公钥失败: %w", err)
	}
	// 关闭密码连接，避免后续用密钥时复用错误的连接
	a.sshMgr.Close(input.Name)

	// 回写 ~/.ssh/config
	cfg := sshconfig.HostConfig{
		Name:         input.Name,
		HostName:     input.HostName,
		User:         input.User,
		Port:         input.Port,
		IdentityFile: input.IdentityFile,
	}
	if err := sshconfig.AppendHost(cfg); err != nil {
		return "", fmt.Errorf("公钥已安装但回写 ssh config 失败: %w", err)
	}
	return "ok", nil
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
