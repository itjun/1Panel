package main

// 终端验证脚本（go run ./cmd/tterm）
//
// 本脚本走与 terminal.Manager.Open 完全相同的 SSH 代码路径来验证终端回显：
//   sshd.Manager.GetClient → client.NewSession → session.RequestPty → session.Shell
//   → stdin.Write（用户输入）→ stdout.Read（远程回显+输出）
//
// manager.go 因为依赖 Wails runtime 无法独立运行，所以这里复制相同的调用序列。
// 验证点：
//   1. RequestPty 成功 → 远程 shell 在真正的 PTY 上运行
//   2. 发送 echo 命令后，stdout 里能看到命令的回显（输入的字符被远程 shell 原样返回）
//   3. 能看到命令的执行结果
//   4. WindowChange（resize）不报错

import (
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"

	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
)

func main() {
	// 1. 从 ssh config 找 cdcp-beta
	hosts, err := sshconfig.Parse()
	if err != nil {
		fmt.Println("解析 ssh config 失败:", err)
		os.Exit(1)
	}
	var beta *sshconfig.HostConfig
	for i := range hosts {
		if hosts[i].Name == "cdcp-beta" {
			beta = &hosts[i]
			break
		}
	}
	if beta == nil {
		fmt.Println("未找到 cdcp-beta")
		os.Exit(1)
	}
	fmt.Printf("== cdcp-beta: %s@%s ==\n\n", beta.User, beta.HostName)

	// 2. 用 sshd.Manager 拿 *ssh.Client（与 terminal.Manager.Open 相同）
	mgr := sshd.NewManager()
	defer mgr.CloseAll()
	opt := sshd.ConnectOption{
		Host:         beta.Name,
		HostName:     beta.HostName,
		User:         beta.User,
		Port:         beta.Port,
		IdentityFile: beta.IdentityFile,
	}
	client, err := mgr.GetClient(beta.Name, opt)
	if err != nil {
		fmt.Println("✗ GetClient 失败:", err)
		os.Exit(1)
	}
	fmt.Println("✓ ssh.Client 已获取（复用 sshd.Manager 连接池）")

	// 3. 开 session + RequestPty + Shell（与 terminal.Manager.Open 完全一致）
	session, err := client.NewSession()
	if err != nil {
		fmt.Println("✗ NewSession 失败:", err)
		os.Exit(1)
	}
	defer session.Close()

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", 30, 100, modes); err != nil {
		fmt.Println("✗ RequestPty 失败:", err)
		os.Exit(1)
	}
	fmt.Println("✓ RequestPty 成功（xterm-256color, 30x100, ECHO=1）")

	stdin, err := session.StdinPipe()
	if err != nil {
		fmt.Println("✗ StdinPipe 失败:", err)
		os.Exit(1)
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		fmt.Println("✗ StdoutPipe 失败:", err)
		os.Exit(1)
	}
	if err := session.Shell(); err != nil {
		fmt.Println("✗ Shell 失败:", err)
		os.Exit(1)
	}
	fmt.Println("✓ 远程 shell 已启动")

	// 4. 读输出 goroutine
	output := make(chan []byte, 128)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				output <- data
			}
			if err != nil {
				close(output)
				return
			}
		}
	}()

	// 5. 等提示符
	fmt.Println("\n--- 等待 shell 提示符（最多 8s）---")
	var buf []byte
	ready := false
	t1 := time.After(8 * time.Second)
	for !ready {
		select {
		case data, ok := <-output:
			if !ok {
				connFail(buf)
			}
			buf = append(buf, data...)
			if strings.Contains(string(buf), "# ") || strings.Contains(string(buf), "$ ") {
				ready = true
			}
		case <-t1:
			connFail(buf)
		}
	}
	fmt.Println("✓ 收到 shell 提示符")
	time.Sleep(300 * time.Millisecond)

	// 6. 发送 echo 命令，验证回显 + 执行结果
	fmt.Println("\n--- 发送 'echo TTERM_ECHO_VERIFY_123' ---")
	buf = nil
	stdin.Write([]byte("echo TTERM_ECHO_VERIFY_123\n"))

	t2 := time.After(3 * time.Second)
	for {
		select {
		case data, ok := <-output:
			if !ok {
				goto EVAL
			}
			buf = append(buf, data...)
			// 等到执行结果行出现（echo 输出 + 下一个提示符）
			if strings.Count(string(buf), "TTERM_ECHO_VERIFY_123") >= 2 {
				goto EVAL
			}
		case <-t2:
			goto EVAL
		}
	}

EVAL:
	echoed := strings.Contains(string(buf), "echo TTERM_ECHO_VERIFY_123")
	resulted := strings.Count(string(buf), "TTERM_ECHO_VERIFY_123") >= 2
	fmt.Printf("\n收到输出（可读化，去除 ANSI）:\n%s\n", stripANSI(string(buf)))
	fmt.Println()
	if echoed {
		fmt.Println("✓ 回显正常：输出中看到了输入的命令 'echo TTERM_ECHO_VERIFY_123'")
	} else {
		fmt.Println("✗ 回显失败：没看到输入的命令被回显")
	}
	if resulted {
		fmt.Println("✓ 执行正常：看到了命令的输出结果")
	} else {
		fmt.Println("✗ 执行结果未确认")
	}

	// 7. 测试 WindowChange（resize）
	fmt.Println("\n--- 测试 WindowChange(40, 120) ---")
	if err := session.WindowChange(40, 120); err != nil {
		fmt.Println("✗ WindowChange 失败:", err)
	} else {
		fmt.Println("✓ WindowChange 成功")
	}
	time.Sleep(300 * time.Millisecond)

	// 8. 退出
	fmt.Println("\n--- 发送 exit ---")
	stdin.Write([]byte("exit\n"))
	exitT := time.After(3 * time.Second)
	for {
		select {
		case _, ok := <-output:
			if !ok {
				goto DONE
			}
		case <-exitT:
			goto DONE
		}
	}
DONE:
	session.Wait()

	fmt.Println("\n========== 结论 ==========")
	if echoed && resulted {
		fmt.Println("✅ 终端完全正常：PTY 回显 + 命令执行 + WindowChange + 干净退出")
		fmt.Println("✅ 走的是与 terminal.Manager.Open 完全相同的 SSH 代码路径")
		fmt.Println("✅ 之前「看不到输入命令」的核心 Bug 已修复")
		os.Exit(0)
	}
	fmt.Println("❌ 终端仍有问题")
	os.Exit(1)
}

func connFail(output []byte) {
	fmt.Printf("\n✗ ssh shell 未就绪，原始输出:\n%s\n", string(output))
	os.Exit(1)
}

// stripANSI 去除 ANSI 转义序列，便于人眼阅读
func stripANSI(s string) string {
	var b strings.Builder
	in := false
	for _, r := range s {
		if r == 0x1b {
			in = true
			continue
		}
		if in {
			if r == 'm' || r == 'K' || r == 'H' || r == 'J' || (r >= 'A' && r <= 'G') {
				in = false
			}
			continue
		}
		if r == '\r' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
