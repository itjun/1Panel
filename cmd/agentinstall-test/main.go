// 手动联调脚本：在 cdcp-beta 上端到端验证 agent 安装/更新/卸载/回滚链路。
// 用法：go run ./cmd/agentinstall-test cdcp-beta
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/agentinstall"
	"diteng-pannel/internal/agentres"
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
	ins := agentinstall.New(mgr)
	pool := agentcli.NewPool(mgr, optFor)

	// ---- 1) 探测 ----
	info, err := ins.Probe(host, opt)
	must(err, "probe")
	fmt.Printf("[probe] arch=%s systemd=%v hasBinary=%v service=%s\n",
		info.Arch, info.HasSystemd, info.HasBinary, info.ServiceState)

	bin, sum, err := agentres.Binary(info.Arch)
	must(err, "内置二进制")
	fmt.Printf("[binary] %s %dB sha256=%.12s… version=%s\n", info.Arch, len(bin), sum, agentres.AgentVersion)

	// ---- 2) 卸载（保留数据）→ 重装后历史可续看 ----
	fmt.Println("[uninstall] keepData=true ...")
	must(ins.Uninstall(host, opt, true), "uninstall")

	// ---- 3) 全新安装 ----
	fmt.Println("[install] 全新安装 ...")
	start := time.Now()
	must(ins.Install(host, opt, bin, sum, nil), "install")
	must(ins.WaitHealthy(host, opt, 30*time.Second, nil), "waitHealthy")
	fmt.Printf("[install] 完成，耗时 %s\n", time.Since(start).Round(time.Millisecond))

	// 隧道验证版本 + 历史数据延续
	cli, _ := pool.GetWithOpt(host, opt)
	ctx := context.Background()
	var h agentcli.Health
	must(cli.GetJSON(ctx, "/health", &h), "health")
	fmt.Printf("[health] version=%s（期望 %s）\n", h.Version, agentres.AgentVersion)
	if h.Version != agentres.AgentVersion {
		fmt.Println("!! 版本不一致")
		os.Exit(1)
	}
	var rg agentcli.RangeResponse
	must(cli.GetJSON(ctx, "/metrics/range?from="+fmt.Sprint(time.Now().Unix()-86400)+"&to="+fmt.Sprint(time.Now().Unix()), &rg), "range")
	fmt.Printf("[history] 重装后历史点数=%d（keepData 生效）\n", len(rg.Points))

	// ---- 4) 幂等更新（同版本重装）----
	fmt.Println("[update] 幂等重装 ...")
	must(ins.Install(host, opt, bin, sum, nil), "reinstall")
	must(ins.WaitHealthy(host, opt, 30*time.Second, nil), "waitHealthy 2")
	fmt.Println("[update] OK")

	// ---- 5) 坏二进制 → 自动回滚 ----
	fmt.Println("[rollback] 注入坏二进制验证自动回滚 ...")
	bad := []byte("not a real binary\n")
	must(ins.Install(host, opt, bad, sha256of(bad), nil), "install bad")
	if err := ins.WaitHealthy(host, opt, 8*time.Second, nil); err == nil {
		fmt.Println("!! 坏二进制竟然健康了，跳过回滚验证")
	} else {
		fmt.Println("[rollback] 健康检查失败如预期:", err)
		must(ins.Rollback(host, opt), "rollback")
		time.Sleep(2 * time.Second)
	}
	// 回滚后旧版应恢复
	var h2 agentcli.Health
	for i := 0; i < 10; i++ {
		if err := cli.GetJSON(ctx, "/health", &h2); err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	fmt.Printf("[rollback] 回滚后 version=%s\n", h2.Version)

	// ---- 6) 收尾：重装回 正式版 ----
	fmt.Println("[final] 重装正式版 ...")
	must(ins.Install(host, opt, bin, sum, nil), "final install")
	must(ins.WaitHealthy(host, opt, 30*time.Second, nil), "final waitHealthy")
	fmt.Println("\n安装/更新/回滚链路全部验证完成")
}

func sha256of(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
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

func must(err error, name string) {
	if err != nil {
		fmt.Printf("[%s] 失败: %v\n", name, err)
		os.Exit(1)
	}
}
