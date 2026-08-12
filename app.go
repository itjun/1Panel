package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/nethist"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
	"diteng-pannel/internal/terminal"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是 Wails 绑定的核心对象
// 所有暴露给前端的方法都挂在它身上
type App struct {
	ctx context.Context

	sshMgr    *sshd.Manager
	collector *monitor.Collector
	groups    *groups.Store
	netHist   *nethist.Store
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

	store, err := groups.NewStore("ServerPanel")
	if err != nil {
		runtime.LogErrorf(ctx, "初始化分组存储失败: %v", err)
	} else {
		a.groups = store
	}
	// 与分组同目录：网卡累计采样，供 1 天 / 7 天流量差分
	if nh, err := nethist.NewStore("ServerPanel"); err != nil {
		runtime.LogErrorf(ctx, "初始化网卡历史失败: %v", err)
	} else {
		a.netHist = nh
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

// AddHost 添加新主机：先校验别名不重复 → 用密码连一次验证 → 推送本机公钥 → 回写 ~/.ssh/config
// 用户只需提供别名/IP/用户/密码 4 项，端口默认 22，公钥/密钥路径自动推断为 ~/.ssh/id_ed25519(.pub)
// 验证通过并推送公钥后，后续对该主机即可免密登录
// 契约：四项必填；只有连通性+凭据验证成功才会写 config（由 CopySSHID 内部完成）
func (a *App) AddHost(input AddHostInput) error {
	input.Name = strings.TrimSpace(input.Name)
	input.HostName = strings.TrimSpace(input.HostName)
	input.User = strings.TrimSpace(input.User)
	// 密码不 trim，保留用户输入原样
	if input.Name == "" || input.HostName == "" || input.User == "" || input.Password == "" {
		return fmt.Errorf("别名、IP、用户、密码均不能为空")
	}
	if strings.ContainsAny(input.Name, " \t*") {
		return fmt.Errorf("别名不能包含空格或通配符 *")
	}
	// 校验别名是否已存在
	hosts, err := sshconfig.Parse()
	if err != nil {
		return fmt.Errorf("读取 ssh config 失败: %w", err)
	}
	for _, h := range hosts {
		if h.Name == input.Name {
			return fmt.Errorf("别名 %s 已存在，请换一个", input.Name)
		}
	}
	// 复用 CopySSHID：密码连接 → 推送公钥 → 回写 config（含 IdentityFile）
	// 密码连接本身就是一次验证；失败则不会写 config
	_, err = a.CopySSHID(CopyIDInput{
		Name:          input.Name,
		HostName:      input.HostName,
		User:          input.User,
		Port:          "22",
		Password:      input.Password,
		PublicKeyFile: "~/.ssh/id_ed25519.pub",
		IdentityFile:  "~/.ssh/id_ed25519",
	})
	return err
}

// TestConnection 用密码尝试 SSH 登录（执行 hostname），仅验证连通性与凭据是否正确
// 不推送公钥、不写 config；测试完立即关闭连接，避免污染连接池
// 成功返回包含远程主机名的提示信息
// 四个字段（别名/IP/用户/密码）均必填，与前端「测试通过后才能保存」契约一致
func (a *App) TestConnection(input AddHostInput) (string, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.HostName = strings.TrimSpace(input.HostName)
	input.User = strings.TrimSpace(input.User)
	if input.Name == "" || input.HostName == "" || input.User == "" || input.Password == "" {
		return "", fmt.Errorf("别名、IP、用户、密码均不能为空")
	}
	// 使用独立缓存 key，避免测试连接污染正式 Host 连接池
	testKey := "__test__:" + input.Name
	opt := sshd.ConnectOption{
		Host:     input.Name,
		HostName: input.HostName,
		User:     input.User,
		Port:     "22",
		Password: input.Password,
	}
	// 无论成功失败都关闭测试连接
	defer a.sshMgr.Close(testKey)

	// 跑一条无害命令验证连通性，顺便取主机名
	out, err := a.sshMgr.Run(testKey, opt, "hostname")
	if err != nil {
		return "", fmt.Errorf("连接失败: %w", err)
	}
	remoteHost := strings.TrimSpace(string(out))
	return fmt.Sprintf("连接成功，远程主机: %s", remoteHost), nil
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

// UpdateHost 编辑主机：密码测试连通性 → 推送本机公钥 → 更新 ~/.ssh/config 中的 HostName/User
// 别名不变；验证失败不写 config
func (a *App) UpdateHost(input UpdateHostInput) error {
	input.Name = strings.TrimSpace(input.Name)
	input.HostName = strings.TrimSpace(input.HostName)
	input.User = strings.TrimSpace(input.User)
	if input.Name == "" || input.HostName == "" || input.User == "" || input.Password == "" {
		return fmt.Errorf("别名、IP、用户、密码均不能为空")
	}

	hosts, err := sshconfig.Parse()
	if err != nil {
		return fmt.Errorf("读取 ssh config 失败: %w", err)
	}
	found := false
	for _, h := range hosts {
		if h.Name == input.Name {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("未找到主机别名: %s", input.Name)
	}

	// 1) 密码验证连通性（不污染正式连接池）
	if _, err := a.TestConnection(AddHostInput{
		Name:     input.Name,
		HostName: input.HostName,
		User:     input.User,
		Password: input.Password,
	}); err != nil {
		return err
	}

	// 2) 推送公钥，保证新 IP/用户下后续可免密
	pub, err := readPublicKey("~/.ssh/id_ed25519.pub")
	if err != nil {
		return err
	}
	opt := sshd.ConnectOption{
		Host:     "__update__:" + input.Name,
		HostName: input.HostName,
		User:     input.User,
		Port:     "22",
		Password: input.Password,
	}
	defer a.sshMgr.Close(opt.Host)
	script := fmt.Sprintf(
		`mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '%s' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys`,
		pub,
	)
	if _, err := a.sshMgr.Run(opt.Host, opt, script); err != nil {
		return fmt.Errorf("安装公钥失败: %w", err)
	}

	// 3) 原地更新 config 字段（IdentityFile 等其它行保持不动）
	if err := sshconfig.UpdateHostFields(input.Name, input.HostName, input.User); err != nil {
		return err
	}

	// 关闭旧连接，下次用新参数重连
	a.sshMgr.Close(input.Name)
	return nil
}

// DeleteHost 从 ~/.ssh/config 删除主机别名，并清理分组引用与连接池
func (a *App) DeleteHost(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("主机别名不能为空")
	}
	if err := sshconfig.DeleteHost(name); err != nil {
		return err
	}
	// 从所有分组中移除
	if a.groups != nil {
		if err := a.groups.AssignHost(name, ""); err != nil {
			runtime.LogWarningf(a.ctx, "清理分组引用失败: %v", err)
		}
	}
	a.sshMgr.Close(name)
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

// ============ 监控 ============

// CollectOverview 采集顶层系统指标（按需/手动刷新，不做秒级轮询落盘）
// 额外根据本机历史采样填充近 1 天 / 7 天收发字节（net1d / net7d）
func (a *App) CollectOverview(host string) (monitor.Overview, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return monitor.Overview{}, err
	}
	ov, err := a.collector.CollectOverview(host, opt)
	if err != nil {
		return ov, err
	}
	if a.netHist != nil {
		d1, d7 := a.netHist.RecordAndWindows(host, ov.NetRxBytes, ov.NetTxBytes)
		ov.Net1d = monitor.NetWindow{
			RxBytes: d1.RxBytes, TxBytes: d1.TxBytes,
			SpanHours: d1.SpanHours, Complete: d1.Complete,
		}
		ov.Net7d = monitor.NetWindow{
			RxBytes: d7.RxBytes, TxBytes: d7.TxBytes,
			SpanHours: d7.SpanHours, Complete: d7.Complete,
		}
	}
	return ov, nil
}

func (a *App) CollectDisks(host string) ([]monitor.DiskInfo, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.CollectDisks(host, opt)
}

// CollectLargestFiles 异步场景：扫描根分区 Top N 大文件（可能较慢，勿阻塞 UI）
func (a *App) CollectLargestFiles(host string, limit int) (monitor.LargeFilesResult, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return monitor.LargeFilesResult{}, err
	}
	return a.collector.CollectLargestFiles(host, opt, limit)
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

// CollectNetwork 网卡 / IP 分类 / TCP 连接 / 疑似卡顿连接
func (a *App) CollectNetwork(host string) (monitor.NetworkSnapshot, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return monitor.NetworkSnapshot{}, err
	}
	return a.collector.CollectNetwork(host, opt)
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

// GetHomeDir 返回远程登录用户的家目录（$HOME）。
// 文件管理器默认打开此路径，而不是系统根 /。
// 远程查询失败时按 SSH User 回退：root → /root，其它 → /home/<user>。
func (a *App) GetHomeDir(host string) (string, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return fallbackHomeDir(opt.User), err
	}
	out, err := a.sshMgr.Run(host, opt, `printf '%s' "$HOME"`)
	home := strings.TrimSpace(string(out))
	if err == nil && home != "" && strings.HasPrefix(home, "/") {
		// 去掉多余尾部斜杠（根目录本身除外）
		if len(home) > 1 {
			home = strings.TrimRight(home, "/")
		}
		return home, nil
	}
	return fallbackHomeDir(opt.User), nil
}

func fallbackHomeDir(user string) string {
	u := strings.TrimSpace(user)
	if u == "" || u == "root" {
		return "/root"
	}
	return "/home/" + u
}

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

// CollectLog 读取指定类型日志的末尾 N 行
// logType: system / auth / kernel / nginx_access / nginx_error
func (a *App) CollectLog(host, logType string, lines int) (monitor.LogResult, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return monitor.LogResult{}, err
	}
	return a.collector.CollectLog(host, logType, opt, lines)
}

// CollectDatabases 检测远程主机上已安装的数据库
func (a *App) CollectDatabases(host string) ([]monitor.DatabaseInfo, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return a.collector.CollectDatabases(host, opt)
}

// DeletePaths 删除远程主机上的多个文件或目录（递归，不可恢复）
// 路径必须是绝对路径；系统根目录（/、/etc、/usr 等）禁止删除
func (a *App) DeletePaths(host string, paths []string) (string, error) {
	if len(paths) == 0 {
		return "", fmt.Errorf("未选择任何文件")
	}
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return "", err
	}
	// 系统根目录黑名单：禁止删除这些目录本身（其下的子目录可正常删）
	systemRoots := map[string]bool{
		"/": true, "/bin": true, "/boot": true, "/dev": true,
		"/etc": true, "/home": true, "/lib": true, "/lib64": true,
		"/opt": true, "/proc": true, "/root": true, "/sbin": true,
		"/sys": true, "/usr": true, "/var": true,
	}
	args := make([]string, 0, len(paths))
	for _, p := range paths {
		c := path.Clean(p)
		if !strings.HasPrefix(c, "/") {
			return "", fmt.Errorf("路径必须为绝对路径: %s", p)
		}
		// 单引号包裹防 shell 注入；含单引号的路径直接拒绝
		if strings.Contains(c, "'") {
			return "", fmt.Errorf("路径含非法字符: %s", p)
		}
		if systemRoots[c] {
			return "", fmt.Errorf("禁止删除系统目录: %s", c)
		}
		args = append(args, "'"+c+"'")
	}
	cmd := "rm -rf " + strings.Join(args, " ")
	out, err := a.sshMgr.Run(host, opt, cmd)
	if err != nil {
		return string(out), fmt.Errorf("删除失败: %w", err)
	}
	return string(out), nil
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
// cols/rows 为 xterm fit 后的真实行列，开 PTY 时就用正确尺寸，避免开局乱码
func (a *App) OpenTerminal(host string, eventName string, cols int, rows int) (string, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return a.termMgr.Open(host, opt, eventName, cols, rows)
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

// buildAppMenu 构造 macOS 应用菜单。
// 第一个子菜单会被 macOS 当作应用菜单(粗体应用名)显示。
// 放弃 menu.AppMenu() role —— 它原子生成、无法插入自定义项。
// 菜单点击回调里读 a.ctx:用户点击发生在 startup 之后,ctx 已就绪。
func (a *App) buildAppMenu() *menu.Menu {
	m := menu.NewMenu()
	appSub := m.AddSubmenu("1Pannel")
	appSub.AddText("设置…", keys.CmdOrCtrl(","), func(_ *menu.CallbackData) {
		runtime.EventsEmit(a.ctx, "open-settings")
	})
	appSub.AddText("重启应用", nil, func(_ *menu.CallbackData) {
		a.restartApp()
	})
	appSub.AddSeparator()
	appSub.AddText("退出 1Pannel", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(a.ctx)
	})
	m.Append(menu.EditMenu())
	m.Append(menu.WindowMenu())
	return m
}

// restartApp 杀掉当前进程并重新启动应用:
// 先在后台 detach 一个「sleep 1; open <bundle>」(1 秒后起新实例),
// 然后当前进程 os.Exit(0) 自杀。子进程 fork 后由系统接管,不受父进程退出影响。
func (a *App) restartApp() {
	exe, err := os.Executable() // .../1Pannel.app/Contents/MacOS/1Pannel 或 .../1Pannel.exe
	if err != nil {
		runtime.Quit(a.ctx)
		return
	}
	if goruntime.GOOS == "windows" {
		// Windows: 直接重新拉起自己的 exe
		_ = exec.Command(exe).Start()
	} else {
		bundle := filepath.Clean(filepath.Join(exe, "..", "..", "..")) // → .../1Pannel.app
		_ = exec.Command("sh", "-c", "sleep 1; open "+strconv.Quote(bundle)).Start()
	}
	os.Exit(0) // 自杀
}
