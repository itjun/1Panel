package main

import (
	"sync"
	"time"

	"diteng-pannel/internal/sshconfig"
)

// ============ 启动预热：资源换速度 ============
//
// SSH 连接与 agent 隧道完全惰性（首次业务调用才建连，握手可达数秒），
// 这里在启动后台把它们全部提前建好：用户点开任意主机时只剩
// agent HTTP 往返（毫秒级），冷主机首开从秒级降到毫秒级。
// 尽力而为：失败静默（离线主机本就不可连），绝不阻塞启动。

// prewarmHostsLater 延迟 1s 启动预热，避开首屏主机列表/分组/图标三连调高峰
func (a *App) prewarmHostsLater() {
	go func() {
		time.Sleep(time.Second)
		a.prewarmHosts()
	}()
}

// prewarmHosts 对 ssh config 全部主机（过滤 Git 服务）并发预热，
// 信号量限流的模式与 AgentBatchInstall 相同（那边并发 3，预热更轻量取 5）。
func (a *App) prewarmHosts() {
	parsed, err := sshconfig.Parse()
	if err != nil {
		return
	}
	sem := make(chan struct{}, 5)
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
			// Status 内部完成整条链路：Client 创建 → token 缓存 →
			// SSH 建连 → direct-tcpip 隧道 → /health → 状态缓存（30s TTL）。
			// 结果无需理会，离线主机静默跳过。
			_ = a.agentPool.Status(name, true)
		}(h.Name)
	}
	wg.Wait()
}
