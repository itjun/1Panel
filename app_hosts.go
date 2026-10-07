package main

import (
	"fmt"
	"strings"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Hosts 主机管理服务：SSH 配置（主机增删改查 + ssh-copy-id 流程）
type Hosts App

// ============ SSH 配置（主机增删改查 + ssh-copy-id 流程） ============

// listNonGitHosts 解析 ~/.ssh/config，过滤 Git 托管服务（github.com / gitee.com 等）
// 供 Hosts.ListHosts、Icons.refreshHostIcons 与 Backup.ExportBackup 共用
func listNonGitHosts() ([]sshconfig.HostConfig, error) {
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

// attachHostNotes 把本机备注合并进 HostConfig.Note（不改 ssh config；不下发密码）
func (s *Hosts) attachHostNotes(hosts []sshconfig.HostConfig) []sshconfig.HostConfig {
	if len(hosts) == 0 {
		return hosts
	}
	out := make([]sshconfig.HostConfig, len(hosts))
	copy(out, hosts)
	for i := range out {
		if (*App)(s).panelStore == nil && s.hostMeta != nil {
			out[i].Note = s.hostMeta.GetNote(out[i].Name)
		}
		out[i].Password = "" // 列表不下发密码
	}
	return out
}

// ListHosts 解析 ~/.ssh/config 返回所有 Host 条目
// 默认过滤掉 Git 托管服务（github.com / gitee.com 等）
// 这些通常不是用户想要管理的"服务器"
func (s *Hosts) ListHosts() ([]sshconfig.HostConfig, error) {
	if (*App)(s).panelStore != nil {
		hosts, err := (*App)(s).panelHostConfigs(false)
		if err != nil {
			return nil, err
		}
		return s.attachHostNotes(hosts), nil
	}
	hosts, err := listNonGitHosts()
	if err != nil {
		return nil, err
	}
	return s.attachHostNotes(hosts), nil
}

// ListHostsAll 返回所有 Host 条目（包括 Git 服务）
// 供前端「显示 Git 服务」开关使用
func (s *Hosts) ListHostsAll() ([]sshconfig.HostConfig, error) {
	if (*App)(s).panelStore != nil {
		hosts, err := (*App)(s).panelHostConfigs(true)
		if err != nil {
			return nil, err
		}
		return s.attachHostNotes(hosts), nil
	}
	hosts, err := sshconfig.Parse()
	if err != nil {
		return nil, err
	}
	return s.attachHostNotes(hosts), nil
}

// AddHost 添加新主机：先校验别名不重复 → 验证凭据 → 回写 ~/.ssh/config
// 用户只需提供别名/IP/用户 3 项，端口默认 22，公钥/密钥路径自动推断为 ~/.ssh/id_ed25519(.pub)
//   - 填了密码：用户+密码验证；并检查本机公钥是否已上传（缺才补传，已存在不动）
//   - 密码留空：只校验本机私钥登录（等同 `ssh user@ip`），不推送公钥
// 契约：只有连通性+凭据验证成功才会写 config
func (s *Hosts) AddHost(input AddHostInput) (string, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.HostName = strings.TrimSpace(input.HostName)
	input.User = strings.TrimSpace(input.User)
	// 密码不 trim，保留用户输入原样
	if input.Name == "" || input.HostName == "" || input.User == "" || input.Password == "" {
		return "", fmt.Errorf("别名、IP、用户、密码均不能为空")
	}
	if strings.ContainsAny(input.Name, " \t\r\n*") {
		return "", fmt.Errorf("别名不能包含空格或通配符 *")
	}
	// 校验别名是否已存在
	hosts, err := s.ListHostsAll()
	if err != nil {
		return "", fmt.Errorf("读取 ssh config 失败: %w", err)
	}
	for _, h := range hosts {
		if h.Name == input.Name {
			return "", fmt.Errorf("别名 %s 已存在，请换一个", input.Name)
		}
	}
	// 密码必填：agent 读 token 依赖 sudo -S 提权，无密码的密钥-only 主机会
	// 在 agent 识别上静默断链。密码连接本身就是一次验证；失败则不会修改 Panel JSON。
	identityFiles := []string{"~/.ssh/id_ed25519"}
	copyInput := CopyIDInput{
		Name:          input.Name,
		HostName:      input.HostName,
		User:          input.User,
		Port:          "22",
		Password:      input.Password,
		PublicKeyFile: "~/.ssh/id_ed25519.pub",
		IdentityFile:  "~/.ssh/id_ed25519",
	}
	already, err := s.installSSHID(copyInput)
	if err != nil {
		return "", err
	}
	verifyMsg := "密码验证通过，公钥已存在"
	if !already {
		verifyMsg = "密码验证通过，已上传公钥（后续可免密登录）"
	}
	if a := (*App)(s); a.panelStore != nil {
		if err := a.mutatePanelStateAndGenerate([]string{}, func(state *panelstore.State) error {
			state.Hosts = append(state.Hosts, panelstore.PanelHost{
				Alias: input.Name, HostName: input.HostName, User: input.User,
				Port: "22", Password: input.Password, Note: input.Note,
				IdentityFiles: identityFiles,
			})
			return nil
		}); err != nil {
			return "", fmt.Errorf("保存 Panel 主机失败: %w", err)
		}
	}
	if (*App)(s).panelStore == nil && s.hostMeta != nil {
		if err := s.hostMeta.SetNote(input.Name, input.Note); err != nil {
			application.Get().Logger.Warn("保存主机备注失败", "error", err)
		}
		if input.Password != "" {
			if err := s.hostMeta.SetPassword(input.Name, input.Password); err != nil {
				application.Get().Logger.Warn("保存主机密码失败", "error", err)
			}
		}
	}
	return verifyMsg, nil
}

// TestConnection 用密码尝试 SSH 登录（执行 hostname），仅验证连通性与凭据是否正确
// 不推送公钥、不写 config；测试完立即关闭连接，避免污染连接池
// 成功返回包含远程主机名的提示信息
// 四个字段（别名/IP/用户/密码）均必填，与前端「测试通过后才能保存」契约一致
func (s *Hosts) TestConnection(input AddHostInput) (string, error) {
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
	defer s.sshMgr.Close(testKey)

	// 跑一条无害命令验证连通性，顺便取主机名
	out, err := s.sshMgr.Run(testKey, opt, "hostname")
	if err != nil {
		return "", fmt.Errorf("连接失败: %w", err)
	}
	remoteHost := strings.TrimSpace(string(out))
	return fmt.Sprintf("连接成功，远程主机: %s", remoteHost), nil
}

// RenameHost 修改 ~/.ssh/config 里 Host 的别名
// 同时同步 groups.json 里的引用，并关闭旧名的 SSH 连接（避免连接池残留）
func (s *Hosts) RenameHost(oldName, newName string) error {
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == "" || newName == "" {
		return fmt.Errorf("主机别名不能为空")
	}
	if strings.ContainsAny(newName, " \t\r\n*?#") {
		return fmt.Errorf("新别名不能包含空格、通配符或注释字符")
	}
	if oldName == newName {
		return nil
	}
	// 先校验 newName 不与已有别名重复
	hosts, err := s.ListHostsAll()
	if err != nil {
		return err
	}
	for _, h := range hosts {
		if h.Name == newName {
			return fmt.Errorf("别名 %s 已存在", newName)
		}
	}
	if a := (*App)(s); a.panelStore != nil {
		if err := a.mutatePanelStateAndGenerate([]string{}, func(state *panelstore.State) error {
			for i := range state.Hosts {
				if state.Hosts[i].Alias == oldName {
					state.Hosts[i].Alias = newName
					return nil
				}
			}
			return fmt.Errorf("未找到主机别名: %s", oldName)
		}); err != nil {
			return err
		}
	} else if err := sshconfig.RenameHost(oldName, newName); err != nil {
		return err
	}
	// 同步分组引用
	if s.groups != nil {
		if err := s.groups.RenameHost(oldName, newName); err != nil {
			application.Get().Logger.Warn("同步分组引用失败", "error", err)
		}
	}
	if s.hostIcons != nil {
		if err := s.hostIcons.Rename(oldName, newName); err != nil {
			application.Get().Logger.Warn("同步主机图标失败", "error", err)
		}
	}
	if (*App)(s).panelStore == nil && s.hostMeta != nil {
		if err := s.hostMeta.Rename(oldName, newName); err != nil {
			application.Get().Logger.Warn("同步主机备注失败", "error", err)
		}
	}
	// 关闭旧连接，下次用新别名时重新建立
	s.sshMgr.Close(oldName)
	return nil
}

// UpdateHost 编辑主机 → 更新 Panel JSON（再生成 config）中的 HostName/User/备注
// 别名不变；验证失败不写 config。成功返回验证结果消息。
//   - 填了密码：密码测连 → 检查本机公钥是否已上传（缺才补传）→ 保存新密码
//   - 未填密码：只校验本机私钥登录（不回退已存密码），不推公钥、不清空已存密码
func (s *Hosts) UpdateHost(input UpdateHostInput) (string, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.HostName = strings.TrimSpace(input.HostName)
	input.User = strings.TrimSpace(input.User)
	if input.Name == "" || input.HostName == "" || input.User == "" || input.Password == "" {
		return "", fmt.Errorf("别名、IP、用户、密码均不能为空")
	}

	var verifyMsg string
	already, err := s.verifyWithPassword(input)
	if err != nil {
		return "", err
	}
	if already {
		verifyMsg = "密码验证通过，公钥已存在"
	} else {
		verifyMsg = "密码验证通过，已上传公钥（后续可免密登录）"
	}

	// 先更新 JSON，再由 JSON 生成 config；IdentityFile、分组和高级选项
	// 都从原 PanelHost 保留，不再对 config 做局部原地改写。
	if a := (*App)(s); a.panelStore != nil {
		if err := a.mutatePanelStateAndGenerate([]string{}, func(state *panelstore.State) error {
			for i := range state.Hosts {
				if state.Hosts[i].Alias == input.Name {
					state.Hosts[i].HostName = input.HostName
					state.Hosts[i].User = input.User
					state.Hosts[i].Password = input.Password
					state.Hosts[i].Note = input.Note
					return nil
				}
			}
			return fmt.Errorf("未找到 Panel 主机: %s", input.Name)
		}); err != nil {
			return "", err
		}
	} else if err := sshconfig.UpdateHostFields(input.Name, input.HostName, input.User); err != nil {
		return "", err
	}

	// 关闭旧连接，下次用新参数重连
	s.sshMgr.Close(input.Name)
	if (*App)(s).panelStore == nil && s.hostMeta != nil {
		if err := s.hostMeta.SetNote(input.Name, input.Note); err != nil {
			application.Get().Logger.Warn("保存主机备注失败", "error", err)
		}
		if err := s.hostMeta.SetPassword(input.Name, input.Password); err != nil {
			application.Get().Logger.Warn("保存主机密码失败", "error", err)
		}
	}
	return verifyMsg, nil
}

// verifyWithPassword 用新密码测连（不污染正式连接池），再检查/补传本机公钥，
// 返回公钥是否原先就在目标主机上。
func (s *Hosts) verifyWithPassword(input UpdateHostInput) (bool, error) {
	if _, err := s.TestConnection(AddHostInput{
		Name:     input.Name,
		HostName: input.HostName,
		User:     input.User,
		Password: input.Password,
	}); err != nil {
		return false, err
	}

	pub, err := readPublicKey("~/.ssh/id_ed25519.pub")
	if err != nil {
		return false, err
	}
	opt := sshd.ConnectOption{
		Host:     "__update__:" + input.Name,
		HostName: input.HostName,
		User:     input.User,
		Port:     "22",
		Password: input.Password,
	}
	return s.ensureAuthorizedKey(opt.Host, opt, pub)
}

// SetHostNote 仅更新本机备注（不改 ssh config、不验连；保留已存密码）
func (s *Hosts) SetHostNote(name, note string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("主机别名不能为空")
	}
	if a := (*App)(s); a.panelStore != nil {
		return a.updatePanelState(func(state *panelstore.State) error {
			for i := range state.Hosts {
				if state.Hosts[i].Alias == name {
					state.Hosts[i].Note = note
					return nil
				}
			}
			return fmt.Errorf("未找到主机: %s", name)
		})
	}
	if s.hostMeta == nil {
		return fmt.Errorf("主机备注存储未初始化")
	}
	return s.hostMeta.SetNote(name, note)
}

// GetHostPassword 读取本机已保存的主机密码（供编辑弹窗预填；未保存则空串）
func (s *Hosts) GetHostPassword(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("主机别名不能为空")
	}
	if (*App)(s).panelStore != nil {
		if h, ok := (*App)(s).panelStore.GetHost(name); ok {
			return h.Password, nil
		}
		return "", nil
	}
	if s.hostMeta == nil {
		return "", nil
	}
	return s.hostMeta.GetPassword(name), nil
}

// FormatHostInfo 拼主机信息文本（含已存密码），供右键「复制信息」
func (s *Hosts) FormatHostInfo(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("主机别名不能为空")
	}
	hosts, err := s.ListHostsAll()
	if err != nil {
		return "", fmt.Errorf("读取 ssh config 失败: %w", err)
	}
	var cfg *sshconfig.HostConfig
	for i := range hosts {
		if hosts[i].Name == name {
			cfg = &hosts[i]
			break
		}
	}
	if cfg == nil {
		return "", fmt.Errorf("未找到主机别名: %s", name)
	}
	password := ""
	note := ""
	if (*App)(s).panelStore != nil {
		if h, ok := (*App)(s).panelStore.GetHost(name); ok {
			password = h.Password
			note = h.Note
		}
	} else if s.hostMeta != nil {
		password = s.hostMeta.GetPassword(name)
		note = s.hostMeta.GetNote(name)
	}
	return fmt.Sprintf(
		"主机：%s\n地址：%s\n用户：%s\n密码：%s\n备注：%s",
		cfg.Name, cfg.HostName, cfg.User, password, note,
	), nil
}

// DeleteHost 从 Panel JSON 删除主机别名，再生成 OpenSSH 配置，并清理分组引用与连接池
func (s *Hosts) DeleteHost(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("主机别名不能为空")
	}
	if a := (*App)(s); a.panelStore != nil {
		if err := a.mutatePanelStateAndGenerate([]string{}, func(state *panelstore.State) error {
			found := false
			out := state.Hosts[:0]
			for _, h := range state.Hosts {
				if h.Alias == name {
					found = true
					continue
				}
				out = append(out, h)
			}
			if !found {
				return fmt.Errorf("未找到主机: %s", name)
			}
			state.Hosts = out
			return nil
		}); err != nil {
			return err
		}
	} else if err := sshconfig.DeleteHost(name); err != nil {
		return err
	}
	// 从所有分组中移除
	if s.groups != nil {
		if err := s.groups.AssignHost(name, ""); err != nil {
			application.Get().Logger.Warn("清理分组引用失败", "error", err)
		}
	}
	if s.hostIcons != nil {
		if err := s.hostIcons.Delete(name); err != nil {
			application.Get().Logger.Warn("清理主机图标失败", "error", err)
		}
	}
	if s.hostMeta != nil {
		if err := s.hostMeta.Delete(name); err != nil {
			application.Get().Logger.Warn("清理主机备注失败", "error", err)
		}
	}
	s.sshMgr.Close(name)
	return nil
}

// CopySSHID 检查本机公钥是否已在目标主机的 authorized_keys（缺才补传），并把结果写入
// Panel JSON；OpenSSH 配置仍由 JSON 统一生成。
// 步骤：
//  1. 读 ~/.ssh/id_ed25519.pub（不存在则提示用户先生成）
//  2. 用密码连一次目标主机，先 grep 检查再按需追加
//  3. 关闭连接
//  4. 回写 ~/.ssh/config（追加 Host 块）
func (s *Hosts) CopySSHID(input CopyIDInput) (string, error) {
	already, err := s.installSSHID(input)
	if err != nil {
		return "", err
	}
	msg := "已上传公钥"
	if already {
		msg = "公钥已存在，无需重复上传"
	}

	if a := (*App)(s); a.panelStore != nil {
		if err := a.mutatePanelStateAndGenerate([]string{}, func(state *panelstore.State) error {
			for i := range state.Hosts {
				if state.Hosts[i].Alias == input.Name {
					state.Hosts[i].HostName = input.HostName
					state.Hosts[i].User = input.User
					state.Hosts[i].Port = input.Port
					state.Hosts[i].Password = input.Password
					state.Hosts[i].IdentityFiles = []string{input.IdentityFile}
					return nil
				}
			}
			state.Hosts = append(state.Hosts, panelstore.PanelHost{
				Alias: input.Name, HostName: input.HostName, User: input.User,
				Port: input.Port, Password: input.Password,
				IdentityFiles: []string{input.IdentityFile},
			})
			return nil
		}); err != nil {
			return "", fmt.Errorf("保存 Panel 主机失败: %w", err)
		}
	} else {
		cfg := sshconfig.HostConfig{
			Name: input.Name, HostName: input.HostName, User: input.User,
			Port: input.Port, IdentityFile: input.IdentityFile,
		}
		if err := sshconfig.AppendHost(cfg); err != nil {
			return "", fmt.Errorf("公钥已安装但回写 ssh config 失败: %w", err)
		}
	}
	return msg, nil
}

// installSSHID only performs the remote credential operation. Keeping it
// separate prevents AddHost from accidentally generating config twice.
// 返回 already=true 表示公钥原先就在目标主机上（本次未改动）。
func (s *Hosts) installSSHID(input CopyIDInput) (bool, error) {
	if strings.TrimSpace(input.Name) == "" || strings.ContainsAny(input.Name, " \t\r\n*?#") {
		return false, fmt.Errorf("主机别名无效")
	}
	if input.PublicKeyFile == "" {
		return false, fmt.Errorf("公钥路径不能为空")
	}
	pub, err := readPublicKey(input.PublicKeyFile)
	if err != nil {
		return false, err
	}
	if input.Port == "" {
		input.Port = "22"
	}
	opt := sshd.ConnectOption{
		Host: input.Name, HostName: input.HostName, User: input.User,
		Port: input.Port, Password: input.Password,
	}
	return s.ensureAuthorizedKey(input.Name, opt, pub)
}

// ensureAuthorizedKey 先检查公钥是否已在目标主机 authorized_keys（按整行精确匹配），
// 已存在则不动；缺失才建目录、收权限后追加。执行完关闭该临时连接。
// 标记 =PRESENT=x 必须单引号包裹：脚本经用户登录 shell 执行，zsh 对裸 = 开头的
// 词做等号展开（=PRESENT=1 被当作命令查找），bash/sh 则无此特性。
func (s *Hosts) ensureAuthorizedKey(cacheKey string, opt sshd.ConnectOption, pub string) (already bool, err error) {
	defer s.sshMgr.Close(cacheKey)
	script := fmt.Sprintf(`if grep -qxF '%s' ~/.ssh/authorized_keys 2>/dev/null; then
  echo '=PRESENT=1'
else
  mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '%s' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo '=PRESENT=0'
fi`, pub, pub)
	out, err := s.sshMgr.Run(cacheKey, opt, script)
	if err != nil {
		return false, fmt.Errorf("检查/安装公钥失败: %w", err)
	}
	return strings.Contains(string(out), "=PRESENT=1"), nil
}
