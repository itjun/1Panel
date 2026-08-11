package main

import (
	"fmt"
	"os/user"
	"sync"

	"diteng-pannel/internal/macauth"
)

// MacUserInfo 当前本机登录用户信息（展示用）
type MacUserInfo struct {
	Username string `json:"username"`
	FullName string `json:"fullName"`
	HomeDir  string `json:"homeDir"`
}

// AuthState 认证状态
type AuthState struct {
	Authenticated bool   `json:"authenticated"`
	Username      string `json:"username"`
}

var (
	authMu   sync.Mutex
	authUser string // 已通过系统认证的本机用户；空表示未解锁
)

// GetCurrentMacUser 返回运行本应用时的 macOS 用户
func (a *App) GetCurrentMacUser() (MacUserInfo, error) {
	u, err := user.Current()
	if err != nil {
		return MacUserInfo{}, fmt.Errorf("读取当前用户失败: %w", err)
	}
	full := u.Name
	if full == "" {
		full = u.Username
	}
	return MacUserInfo{
		Username: u.Username,
		FullName: full,
		HomeDir:  u.HomeDir,
	}, nil
}

// AuthStatus 查询当前会话是否已通过系统认证
func (a *App) AuthStatus() AuthState {
	authMu.Lock()
	defer authMu.Unlock()
	return AuthState{
		Authenticated: authUser != "",
		Username:      authUser,
	}
}

// AuthenticateWithSystem 调用 macOS LocalAuthentication 系统面板
// （Touch ID 或「输入密码」系统对话框，非应用内输入框）
func (a *App) AuthenticateWithSystem() (AuthState, error) {
	cur, err := user.Current()
	if err != nil {
		return AuthState{}, fmt.Errorf("读取当前用户失败: %w", err)
	}

	reason := fmt.Sprintf("使用 Mac 密码或 Touch ID 解锁 1Pannel（用户 %s）", cur.Username)
	if err := macauth.AuthenticateWithSystem(reason); err != nil {
		return AuthState{}, err
	}

	authMu.Lock()
	authUser = cur.Username
	authMu.Unlock()

	return AuthState{Authenticated: true, Username: cur.Username}, nil
}

// AuthenticateMacUser 兼容旧前端：忽略表单密码，改为系统认证
// 保留方法名避免旧绑定报错；实际走 AuthenticateWithSystem
func (a *App) AuthenticateMacUser(username, password string) (AuthState, error) {
	_ = username
	_ = password
	return a.AuthenticateWithSystem()
}

// LogoutMacUser 锁定应用（返回登录页）
func (a *App) LogoutMacUser() AuthState {
	authMu.Lock()
	authUser = ""
	authMu.Unlock()
	return AuthState{Authenticated: false, Username: ""}
}
