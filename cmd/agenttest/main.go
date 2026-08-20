// 手动联调脚本：从开发机经 SSH 隧道访问 cdcp-beta 上的 spanel-agent，
// 端到端验证面板数据面（agentcli Pool → direct-tcpip → agent HTTP）。
// 用法：go run ./cmd/agenttest cdcp-beta
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
)

func main() {
	host := "cdcp-beta"
	if len(os.Args) > 1 {
		host = os.Args[1]
	}
	opt, err := optFor(host)
	if err != nil {
		fmt.Println("ssh config:", err)
		os.Exit(1)
	}

	mgr := sshd.NewManager()
	defer mgr.CloseAll()
	pool := agentcli.NewPool(mgr, optFor)
	cli, err := pool.GetWithOpt(host, opt)
	if err != nil {
		fmt.Println("client:", err)
		os.Exit(1)
	}
	ctx := context.Background()

	// 1) 状态探测
	st := pool.Status(host, true)
	fmt.Printf("[status] ok=%v version=%s rssKB=%d err=%q\n", st.OK, st.Version, st.RSSKB, st.Error)

	// 2) health
	var h agentcli.Health
	must(ctx, cli.GetJSON(ctx, "/health", &h), "health")
	fmt.Printf("[health] version=%s uptime=%ds rss=%dKB dropped=%d\n",
		h.Version, h.UptimeSec, h.RSSKB, h.Dropped)

	// 3) current（面板 CollectOverview 同链路）
	var cur agentcli.CurrentResponse
	must(ctx, cli.GetJSON(ctx, "/metrics/current", &cur), "current")
	fmt.Printf("[current] cpu=%.2f%% mem=%d/%d net=%.1fKB/s io(r/w)=%.1f/%.1fKB/s host=%s\n",
		cur.Metrics.CPUPercent, cur.Metrics.MemUsed, cur.Metrics.MemTotal,
		cur.Metrics.NetRxKBps, cur.Metrics.DiskReadKBps, cur.Metrics.DiskWriteKBps,
		cur.Info.Hostname)

	// 4) range（最近 1 小时实时区间 raw；长区间自动走 agg）
	to := time.Now().Unix()
	var rg agentcli.RangeResponse
	must(ctx, cli.GetJSON(ctx, "/metrics/range?from="+fmt.Sprint(to-3600)+"&to="+fmt.Sprint(to), &rg), "range")
	fmt.Printf("[range] src=%s points=%d\n", rg.Src, len(rg.Points))

	// 5) summary + events
	var sums []agentcli.SummaryRange
	must(ctx, cli.GetJSON(ctx, "/metrics/summary", &sums), "summary")
	for _, s := range sums {
		fmt.Printf("[summary] %-3s cpuAvg=%.2f cpuMax=%.2f memMax=%d\n", s.Name, s.CPUAvg, s.CPUMax, s.MemUsedMax)
	}
	var evs []agentcli.AgentEvent
	must(ctx, cli.GetJSON(ctx, "/events", &evs), "events")
	fmt.Printf("[events] %d 条（最新: %s）\n", len(evs), lastMsg(evs))

	// 6) 全部 /collect 端点（面板各视图同链路）
	type ep struct {
		name string
		path string
	}
	eps := []ep{
		{"disks", "/collect/disks"},
		{"processes", "/collect/processes?limit=5"},
		{"network", "/collect/network"},
		{"docker", "/collect/docker"},
		{"services", "/collect/services"},
		{"crons", "/collect/crons"},
		{"runtimes", "/collect/runtimes"},
		{"runtime-counts", "/collect/runtime-counts"},
		{"packages", "/collect/packages"},
		{"home-dir", "/collect/home-dir"},
		{"dir-root", "/collect/dir?path=/"},
		{"certs", "/collect/certs"},
		{"os-release", "/collect/os-release"},
		{"logs", "/collect/logs?type=system&lines=3"},
	}
	for _, e := range eps {
		var raw json.RawMessage
		if err := cli.GetJSON(ctx, e.path, &raw, true); err != nil {
			fmt.Printf("[collect:%s] 失败: %v\n", e.name, err)
			continue
		}
		fmt.Printf("[collect:%s] OK %d bytes\n", e.name, len(raw))
	}

	// 7) 类型化抽查：disks 反序列化回 monitor.DiskInfo（面板同款）
	var disks []monitor.DiskInfo
	must(ctx, cli.GetJSON(ctx, "/collect/disks", &disks, true), "disks typed")
	for _, d := range disks {
		fmt.Printf("[disks] %s %s %.1f%%\n", d.Mount, d.FSType, d.Percent)
	}

	fmt.Println("\n全部链路验证完成")
}

func optFor(host string) (sshd.ConnectOption, error) {
	hosts, err := sshconfig.Parse()
	if err != nil {
		return sshd.ConnectOption{}, err
	}
	for _, h := range hosts {
		if h.Name == host {
			return sshd.ConnectOption{
				Host: h.Name, HostName: h.HostName, User: h.User,
				Port: h.Port, IdentityFile: h.IdentityFile,
			}, nil
		}
	}
	return sshd.ConnectOption{}, fmt.Errorf("未找到 Host %s", host)
}

func must(_ context.Context, err error, name string) {
	if err != nil {
		fmt.Printf("[%s] 失败: %v\n", name, err)
		os.Exit(1)
	}
}

func lastMsg(evs []agentcli.AgentEvent) string {
	if len(evs) == 0 {
		return "-"
	}
	return evs[0].Msg
}
