// agentversion：spanel-agent 源码变动时同步版本号。
//
//	go run ./cmd/agentversion sync   # 哈希变了则升补丁号，打印最终版本
//	go run ./cmd/agentversion check  # 哈希与戳不一致则退出 1
package main

import (
	"fmt"
	"os"

	"diteng-pannel/internal/agentres"
)

func main() {
	cmd := "sync"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	root, err := agentres.ModuleRoot("")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	switch cmd {
	case "sync":
		ver, _, msg, err := agentres.SyncAgentVersion(root)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, msg)
		fmt.Println(ver)
	case "check":
		hash, err := agentres.HashAgentSources(root)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		got, _, err := agentres.ReadSourceStamp(root)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if got != hash {
			fmt.Fprintln(os.Stderr, "spanel-agent 源码已改但未升级版本，请运行 task agent:build")
			os.Exit(1)
		}
		ver, err := agentres.ReadAgentVersion(root)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(ver)
	default:
		fmt.Fprintf(os.Stderr, "未知命令 %s（sync|check）\n", cmd)
		os.Exit(1)
	}
}
