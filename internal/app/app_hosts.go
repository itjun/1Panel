package app

import (
	"fmt"
	"net"
	"strconv"
	"strings"

	"diteng-pannel/internal/panelstore"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
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

// AddHost 验证登录凭据，检查或安装登录公钥，然后写入 SSH 配置和主机指纹。
func (s *Hosts) AddHost(input AddHostInput) (string, error) {
	return s.addHost(input, "22")
}

func (s *Hosts) addHost(input AddHostInput, port string) (string, error) {
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
	a := (*App)(s)
	keyAlias := ""
	existing := false
	if a.panelStore != nil {
		host, _ := a.panelStore.GetHost(input.Name)
		keyAlias = hostKeyAlias(host)
	} else {
		hosts, err := s.ListHostsAll()
		if err != nil {
			return "", fmt.Errorf("读取 ssh config 失败: %w", err)
		}
		for _, host := range hosts {
			if host.Name == input.Name {
				existing = true
				break
			}
		}
	}
	// 密码必填：agent 读 token 依赖 sudo -S 提权，无密码的密钥-only 主机会
	// 在 agent 识别上静默断链。密码连接本身就是一次验证；失败则不会修改 Panel JSON。
	identityFiles := []string{"~/.ssh/id_ed25519"}
	copyInput := CopyIDInput{
		Name:          input.Name,
		HostName:      input.HostName,
		User:          input.User,
		Port:          port,
		Password:      input.Password,
		PublicKeyFile: "~/.ssh/id_ed25519.pub",
		IdentityFile:  "~/.ssh/id_ed25519",
	}
	var hostKey observedHostKey
	already, err := s.installSSHID(copyInput, hostKey.capture)
	if err != nil {
		return "", err
	}
	if hostKey.key == nil {
		return "", fmt.Errorf("SSH 连接未返回主机公钥")
	}
	verifyMsg := "密码验证通过，公钥已存在"
	if !already {
		verifyMsg = "密码验证通过，已上传公钥（后续可免密登录）"
	}
	err = sshconfig.WithKnownHostKey(input.HostName, copyInput.Port, keyAlias, hostKey.key, func() error {
		if a.panelStore != nil {
			return a.mutateRegisteredHost("", func(state *panelstore.State) error {
				for i := range state.Hosts {
					host := &state.Hosts[i]
					if host.Alias != input.Name {
						continue
					}
					if hostKeyAlias(*host) != keyAlias {
						return fmt.Errorf("主机 %s 的指纹配置已变化，请重新登记", input.Name)
					}
					host.HostName, host.User, host.Port = input.HostName, input.User, copyInput.Port
					host.Password, host.IdentityFiles = input.Password, identityFiles
					if input.Note != "" {
						host.Note = input.Note
					}
					return nil
				}
				if keyAlias != "" {
					return fmt.Errorf("主机 %s 的指纹配置已变化，请重新登记", input.Name)
				}
				state.Hosts = append(state.Hosts, panelstore.PanelHost{
					Alias: input.Name, HostName: input.HostName, User: input.User,
					Port: copyInput.Port, Password: input.Password, Note: input.Note,
					IdentityFiles: identityFiles,
				})
				return nil
			})
		}
		if existing {
			return sshconfig.UpdateHostFields(input.Name, input.HostName, input.User)
		}
		return sshconfig.AppendHost(sshconfig.HostConfig{
			Name: input.Name, HostName: input.HostName, User: input.User,
			Port: copyInput.Port, IdentityFile: copyInput.IdentityFile,
		})
	})
	if err != nil {
		return "", fmt.Errorf("保存主机失败: %w", err)
	}
	if a.panelStore == nil && s.hostMeta != nil {
		if err := s.hostMeta.SetNote(input.Name, input.Note); err != nil {
			application.Get().Logger.Warn("保存主机备注失败", "error", err)
		}
		if input.Password != "" {
			if err := s.hostMeta.SetPassword(input.Name, input.Password); err != nil {
				application.Get().Logger.Warn("保存主机密码失败", "error", err)
			}
		}
	}
	return verifyMsg + "，已保存本机 SSH 主机指纹", nil
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
	s.syncRenamedHost(oldName, newName)
	return nil
}

func (s *Hosts) syncRenamedHost(oldName, newName string) {
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
}

// UpdateHost verifies SSH on the edited endpoint and repairs the OpenSSH host
// key if necessary before committing the new configuration.
func (s *Hosts) UpdateHost(input UpdateHostInput) (string, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.NewName = strings.TrimSpace(input.NewName)
	input.HostName = strings.TrimSpace(input.HostName)
	input.User = strings.TrimSpace(input.User)
	if input.Name == "" || input.HostName == "" || input.User == "" || input.Password == "" {
		return "", fmt.Errorf("别名、IP、用户、密码均不能为空")
	}

	if input.NewName == "" {
		input.NewName = input.Name
	}
	if input.NewName != input.Name && strings.ContainsAny(input.NewName, " \t\r\n*?#") {
		return "", fmt.Errorf("新别名不能包含空格、通配符或注释字符")
	}
	a := (*App)(s)
	opt, err := a.connectOptionFor(input.Name)
	if err != nil {
		return "", err
	}
	if opt.Port == "" {
		opt.Port = "22"
	}
	port := strings.TrimSpace(input.Port)
	if port == "" {
		port = opt.Port
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return "", fmt.Errorf("SSH 端口必须在 1 到 65535 之间")
	}
	port = strconv.Itoa(portNumber)
	keyAlias := ""
	if a.panelStore != nil {
		host, _ := a.panelStore.GetHost(input.Name)
		keyAlias = hostKeyAlias(host)
	} else if s.hostMeta != nil {
		opt.Password = s.hostMeta.GetPassword(input.Name)
	}
	credentialsChanged := opt.HostName != input.HostName || opt.User != input.User || opt.Password != input.Password
	connectionChanged := credentialsChanged || opt.Port != port
	opt.HostName, opt.User, opt.Password, opt.Port = input.HostName, input.User, input.Password, port
	opt.ForwardAgent = false
	if opt.HostKeyAlgos == "" {
		opt.HostKeyAlgos, err = sshconfig.KnownHostAlgorithms(opt.HostName, opt.Port, keyAlias)
		if err != nil {
			return "", err
		}
	}
	var hostKey observedHostKey
	opt.HostKeyCheck = hostKey.capture
	verifyMsg, err := s.verifyHostEdit(opt, credentialsChanged)
	if err != nil {
		return "", err
	}
	if hostKey.key == nil {
		return "", fmt.Errorf("SSH 连接未返回主机公钥")
	}

	repaired, err := sshconfig.WithCheckedHostKey(opt.HostName, opt.Port, keyAlias, hostKey.key, func() error {
		if a.panelStore != nil {
			return a.mutateRegisteredHost("", func(state *panelstore.State) error {
				for _, host := range state.Hosts {
					if host.Alias == input.NewName && input.NewName != input.Name {
						return fmt.Errorf("别名 %s 已存在", input.NewName)
					}
				}
				for i := range state.Hosts {
					host := &state.Hosts[i]
					if host.Alias == input.Name {
						if hostKeyAlias(*host) != keyAlias {
							return fmt.Errorf("主机 %s 的指纹配置已变化，请重新保存", input.Name)
						}
						host.Alias, host.HostName, host.User, host.Port = input.NewName, input.HostName, input.User, port
						host.Password, host.Note = input.Password, input.Note
						return nil
					}
				}
				return fmt.Errorf("未找到 Panel 主机: %s", input.Name)
			})
		}
		return sshconfig.UpdateHostEndpoint(input.Name, input.NewName, input.HostName, input.User, port)
	})
	if err != nil {
		return "", err
	}
	if input.NewName != input.Name {
		s.syncRenamedHost(input.Name, input.NewName)
	} else if connectionChanged || repaired {
		s.sshMgr.Close(input.Name)
	}
	if a.panelStore == nil && s.hostMeta != nil {
		if err := s.hostMeta.SetNote(input.NewName, input.Note); err != nil {
			application.Get().Logger.Warn("保存主机备注失败", "error", err)
		}
		if err := s.hostMeta.SetPassword(input.NewName, input.Password); err != nil {
			application.Get().Logger.Warn("保存主机密码失败", "error", err)
		}
	}
	if repaired {
		if verifyMsg != "" {
			verifyMsg += "，"
		}
		verifyMsg += "已更新本机 SSH 主机指纹"
	}
	return verifyMsg, nil
}

func (s *Hosts) verifyHostEdit(opt sshd.ConnectOption, credentialsChanged bool) (string, error) {
	if !credentialsChanged {
		client, err := s.sshMgr.DialNew(opt)
		if err != nil {
			return "", fmt.Errorf("检查 SSH 连接失败: %w", err)
		}
		_ = client.Close()
		return "", nil
	}
	pub, err := readPublicKey("~/.ssh/id_ed25519.pub")
	if err != nil {
		return "", err
	}
	opt.IdentityFile, opt.IdentityFiles, opt.IdentityAgent = "", nil, "none"
	already, err := s.ensureAuthorizedKey(opt.Host, opt, pub)
	if err != nil {
		return "", err
	}
	if already {
		return "密码验证通过，公钥已存在", nil
	}
	return "密码验证通过，已上传公钥（后续可免密登录）", nil
}

type observedHostKey struct{ key ssh.PublicKey }

func (k *observedHostKey) capture(_ string, _ net.Addr, key ssh.PublicKey) error {
	if k.key == nil {
		k.key = key
	} else if string(k.key.Marshal()) != string(key.Marshal()) {
		return fmt.Errorf("SSH 主机公钥在连接期间发生变化")
	}
	return nil
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

// DeleteHost 删除主机别名、本机 OpenSSH 配置和主机指纹，并清理分组引用与连接池。
func (s *Hosts) DeleteHost(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("主机别名不能为空")
	}
	a := (*App)(s)
	if a.panelStore != nil {
		host, ok := a.panelStore.GetHost(name)
		if !ok {
			return fmt.Errorf("未找到主机: %s", name)
		}
		keyAlias := hostKeyAlias(host)
		err := sshconfig.WithKnownHostKey(host.HostName, host.Port, keyAlias, nil, func() error {
			return a.mutateRegisteredHost(name, func(state *panelstore.State) error {
				found := false
				out := state.Hosts[:0]
				for _, h := range state.Hosts {
					if h.Alias == name {
						if h.HostName != host.HostName || h.Port != host.Port || hostKeyAlias(h) != keyAlias {
							return fmt.Errorf("主机 %s 的地址或指纹配置已变化，请重新删除", name)
						}
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
			})
		})
		if err != nil {
			return err
		}
	} else {
		host, err := a.connectOptionFor(name)
		if err != nil {
			return err
		}
		address := host.HostName
		if address == "" {
			address = name
		}
		if err := sshconfig.WithKnownHostKey(address, host.Port, "", nil, func() error {
			return sshconfig.DeleteHost(name)
		}); err != nil {
			return err
		}
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

func hostKeyAlias(host panelstore.PanelHost) string {
	for _, option := range host.ExtraOptions {
		if strings.EqualFold(option.Key, "HostKeyAlias") {
			return option.Value
		}
	}
	return ""
}

// CopySSHID 检查本机公钥是否已在目标主机的 authorized_keys（缺才补传），并把结果写入
// Panel JSON；OpenSSH 配置仍由 JSON 统一生成。
// 步骤：
//  1. 读 ~/.ssh/id_ed25519.pub（不存在则提示用户先生成）
//  2. 用密码连一次目标主机，先 grep 检查再按需追加
//  3. 关闭连接
//  4. 回写 ~/.ssh/config（追加 Host 块）
func (s *Hosts) CopySSHID(input CopyIDInput) (string, error) {
	already, err := s.installSSHID(input, nil)
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
func (s *Hosts) installSSHID(input CopyIDInput, hostKeyCheck ssh.HostKeyCallback) (bool, error) {
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
		Port: input.Port, Password: input.Password, HostKeyCheck: hostKeyCheck,
	}
	return s.ensureAuthorizedKey(input.Name, opt, pub)
}

// ensureAuthorizedKey 先检查公钥是否已在目标主机 authorized_keys（按整行精确匹配），
// 已存在则不动；缺失才建目录、收权限后追加。执行完关闭该临时连接。
// 标记 =PRESENT=x 必须单引号包裹：脚本经用户登录 shell 执行，zsh 对裸 = 开头的
// 词做等号展开（=PRESENT=1 被当作命令查找），bash/sh 则无此特性。
func (s *Hosts) ensureAuthorizedKey(cacheKey string, opt sshd.ConnectOption, pub string) (already bool, err error) {
	script := fmt.Sprintf(`if grep -qxF '%s' ~/.ssh/authorized_keys 2>/dev/null; then
  echo '=PRESENT=1'
else
  mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '%s' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo '=PRESENT=0'
fi`, pub, pub)
	var out []byte
	if opt.HostKeyCheck != nil {
		out, err = s.sshMgr.RunNew(opt, script)
	} else {
		defer s.sshMgr.Close(cacheKey)
		out, err = s.sshMgr.Run(cacheKey, opt, script)
	}
	if err != nil {
		return false, fmt.Errorf("检查/安装公钥失败: %w", err)
	}
	return strings.Contains(string(out), "=PRESENT=1"), nil
}
