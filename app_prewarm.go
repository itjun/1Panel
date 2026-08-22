package main

import (
	"sync"

	"diteng-pannel/internal/sshconfig"
)

// ============ 启动预热：资源换速度 ============
//
// SSH 连接与 agent 隧道完全惰性（首次业务调用才建连，握手可达数秒），
// 这里在启动后台把它们全部提前建好：用户点开任意主机时只剩
// agent HTTP 往返（毫秒级），冷主机首开从秒级降到毫秒级。
// 尽力而为：失败静默（离线主机本就不可连），绝不阻塞启动。

// prewarmHosts 只预热已经装了 agent 的主机。
// 未安装的 Status 会记住 NotInstalled，之后不再 SSH 探活（安装成功会 InvalidateStatus）。
func (a *App) prewarmHosts() {
	parsed, err := sshconfig.Parse()
	if err != nil {
		return
	}
	sem := make(chan struct{}, 16)
	var wg sync.WaitGroup
	for _, h := range parsed {
		if sshconfig.IsGitHost(h) {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(name string) {
			defer wg.Done()
			defer func() { <-sem }()
			st := a.agentPool.Status(name, false)
			if st.NotInstalled || !st.OK {
				return
			}
		}(h.Name)
	}
	wg.Wait()
}
