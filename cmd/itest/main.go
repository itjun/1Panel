package main

import (
	"context"
	"fmt"
	"os"

	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
)

// 这不是真正的 _test.go，是一个手动联调脚本（用 go run 跑）
// 用 cdcp-beta 端到端验证所有采集函数
func main() {
	ctx := context.Background()
	_ = ctx

	hosts, err := sshconfig.Parse()
	if err != nil {
		fmt.Println("解析 ssh config 失败:", err)
		os.Exit(1)
	}
	fmt.Printf("== 解析到 %d 个 Host（未过滤）==\n", len(hosts))
	for _, h := range hosts {
		tag := ""
		if sshconfig.IsGitHost(h) {
			tag = " [GIT, 过滤]"
		}
		fmt.Printf("  - %-15s %s@%s%s\n", h.Name, h.User, h.HostName, tag)
	}

	// 找 cdcp-beta
	var beta *sshconfig.HostConfig
	for i := range hosts {
		if hosts[i].Name == "cdcp-beta" {
			beta = &hosts[i]
			break
		}
	}
	if beta == nil {
		fmt.Println("\n未找到 cdcp-beta")
		os.Exit(1)
	}
	fmt.Printf("\n== 用 %s 联调采集 ==\n", beta.Name)

	mgr := sshd.NewManager()
	defer mgr.CloseAll()
	coll := monitor.NewCollector(mgr)

	opt := sshd.ConnectOption{
		Host:         beta.Name,
		HostName:     beta.HostName,
		User:         beta.User,
		Port:         beta.Port,
		IdentityFile: beta.IdentityFile,
	}

	// 1. Overview
	fmt.Println("\n[Overview]")
	ov, err := coll.CollectOverview(beta.Name, opt)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		fmt.Printf("  CPU=%.1f%% MEM=%.1f%% (%.1fGB/%.1fGB) Load1=%.2f CPU核数=%d\n",
			ov.CPUPercent, ov.MemPercent,
			float64(ov.MemUsed)/1e9, float64(ov.MemTotal)/1e9,
			ov.Load1, ov.CPUCount)
		fmt.Printf("  OS=%s Kernel=%s Model=%s\n", ov.OSRelease, ov.Kernel, ov.CPUModel)
		fmt.Printf("  Swap=%d/%d Uptime=%ds\n", ov.SwapUsed, ov.SwapTotal, ov.Uptime)
	}

	// 2. Disks
	fmt.Println("\n[Disks]")
	disks, err := coll.CollectDisks(beta.Name, opt)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		for _, d := range disks {
			fmt.Printf("  %-20s %.1f%%  %.1fGB/%.1fGB\n",
				d.Mount, d.Percent,
				float64(d.Used)/1e9, float64(d.Total)/1e9)
		}
	}

	// 3. Processes (top 5)
	fmt.Println("\n[Processes top 5]")
	procs, err := coll.CollectProcesses(beta.Name, opt, 5)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		for _, p := range procs {
			cmd := p.Cmd
			if len(cmd) > 60 {
				cmd = cmd[:60] + "..."
			}
			fmt.Printf("  PID=%-6d CPU=%5.1f%% MEM=%5.1f%% %s\n", p.PID, p.CPU, p.Mem, cmd)
		}
	}

	// 4. Java
	fmt.Println("\n[Java processes]")
	java, err := coll.CollectJava(beta.Name, opt)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		if len(java) == 0 {
			fmt.Println("  (无 Java 进程)")
		}
		for _, p := range java {
			fmt.Printf("  PID=%d CPU=%.1f%% %s\n", p.PID, p.CPU, p.Cmd[:min(60, len(p.Cmd))])
		}
	}

	// 5. Docker
	fmt.Println("\n[Docker]")
	dk, err := coll.CollectDocker(beta.Name, opt)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else if !dk.Available {
		fmt.Println("  Docker 不可用")
	} else {
		statMap := map[string]monitor.ContainerStat{}
		for _, s := range dk.Stats {
			statMap[s.Name] = s
		}
		fmt.Printf("  共 %d 个容器\n", len(dk.Containers))
		for _, c := range dk.Containers {
			s := statMap[c.Name]
			fmt.Printf("  %-20s %s CPU=%.2f%% MEM=%.2f%% (%s)\n",
				c.Name, c.State, s.CPUPercent, s.MemPercent, c.Image[:min(30, len(c.Image))])
		}
	}

	// 6. Services (前 5)
	fmt.Println("\n[Services 前 5]")
	svcs, err := coll.CollectServices(beta.Name, opt)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		fmt.Printf("  共 %d 个运行中服务\n", len(svcs))
		for i := 0; i < len(svcs) && i < 5; i++ {
			fmt.Printf("  - %s (%s)\n", svcs[i].Name, svcs[i].Sub)
		}
	}

	// 7. Cron (前 5)
	fmt.Println("\n[Cron 前 5]")
	crons, err := coll.CollectCrons(beta.Name, opt)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		fmt.Printf("  共 %d 条\n", len(crons))
		for i := 0; i < len(crons) && i < 5; i++ {
			fmt.Printf("  [%s] %s\n", crons[i].Source, crons[i].Line[:min(60, len(crons[i].Line))])
		}
	}

	// 8. Packages (前 3)
	fmt.Println("\n[Packages 前 3]")
	pkgs, err := coll.CollectPackages(beta.Name, opt)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		fmt.Printf("  共 %d 个包\n", len(pkgs))
		for i := 0; i < len(pkgs) && i < 3; i++ {
			fmt.Printf("  - %s = %s\n", pkgs[i].Name, pkgs[i].Version)
		}
	}

	// 9. groups store
	fmt.Println("\n[Groups Store]")
	store, err := groups.NewStore("ServerPanel-test")
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		fmt.Println("  分组路径:", store.Path())
		fmt.Printf("  当前分组数: %d\n", len(store.List()))
	}

	// 10. ListDir（文件浏览）
	fmt.Println("\n[ListDir /]")
	entries, err := coll.ListDir(beta.Name, opt, "/")
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		fmt.Printf("  根目录 %d 个条目\n", len(entries))
		for i, e := range entries {
			if i >= 8 {
				fmt.Println("  ...")
				break
			}
			tag := "F"
			if e.IsDir {
				tag = "D"
			}
			fmt.Printf("  [%s] %-20s %s\n", tag, e.Name, e.Mode)
		}
	}

	// 11. ReadFileText
	fmt.Println("\n[ReadFileText /etc/hostname]")
	content, err := coll.ReadFileText(beta.Name, opt, "/etc/hostname", 1024)
	if err != nil {
		fmt.Println("  ERR:", err)
	} else {
		fmt.Printf("  内容: %q\n", content)
	}

	// 12. RenameHost 往返验证：cdcp-beta → cdcp-beta-tmp → cdcp-beta
	// 确保改名不破坏 ssh config 结构，改回来后完全恢复
	fmt.Println("\n[RenameHost 往返验证]")
	tmpName := "cdcp-beta-tmp-rename-test"
	// 改成临时名
	if err := sshconfig.RenameHost("cdcp-beta", tmpName); err != nil {
		fmt.Println("  改成临时名 ERR:", err)
	} else {
		fmt.Printf("  ✓ 改成 %s 成功\n", tmpName)
		// 验证：Parse 能找到新名
		after, _ := sshconfig.Parse()
		found := false
		for _, h := range after {
			if h.Name == tmpName {
				fmt.Printf("  ✓ Parse 找到新别名（HostName=%s User=%s）\n", h.HostName, h.User)
				found = true
			}
			if h.Name == "cdcp-beta" {
				fmt.Println("  ✗ 旧别名仍存在！")
			}
		}
		if !found {
			fmt.Println("  ✗ Parse 未找到新别名")
		}
		// 改回来
		if err := sshconfig.RenameHost(tmpName, "cdcp-beta"); err != nil {
			fmt.Println("  改回来 ERR:", err)
		} else {
			// 验证完全恢复
			final, _ := sshconfig.Parse()
			for _, h := range final {
				if h.Name == "cdcp-beta" {
					fmt.Printf("  ✓ 改回来成功（HostName=%s User=%s Port=%s）\n", h.HostName, h.User, h.Port)
				}
			}
			fmt.Println("  备份文件已生成（.bak.时间戳）")
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
