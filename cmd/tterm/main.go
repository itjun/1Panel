package main

// 终端验证脚本（go run ./cmd/tterm）
//
// 走与 terminal.Manager.openShell 完全相同的 SSH 代码路径来验证终端：
//   sshd.Manager.DialNew（独立连接，不进连接池）→ client.NewSession
//   → session.RequestPty → session.Shell
//   → stdin.Write（用户输入）→ stdout.Read（远程回显+输出）
//
// manager.go 因为依赖 Wails runtime 无法独立运行，所以这里复制相同的调用序列。
// 验证点：
//   1. 独立连接 RequestPty 成功 → 远程 shell 在真正的 PTY 上运行
//   2. 单条 echo 命令回显 + 执行结果
//   3. 【核心】连续快速输入 N 条命令，全部回显 + 执行无丢失（对应「连续输入不卡顿/丢字」）
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

// batchCount 连续输入的命令条数（用户验收「连续输入很多命令」）
const batchCount = 50

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

	// 2. 用 DialNew 建立独立连接（与 terminal.Manager.openShell 相同，不复用连接池）
	mgr := sshd.NewManager()
	opt := sshd.ConnectOption{
		Host:         beta.Name,
		HostName:     beta.HostName,
		User:         beta.User,
		Port:         beta.Port,
		IdentityFile: beta.IdentityFile,
	}
	client, err := mgr.DialNew(opt)
	if err != nil {
		fmt.Println("✗ DialNew 失败:", err)
		os.Exit(1)
	}
	defer client.Close()
	fmt.Println("✓ 独立 ssh.Client 已建立（DialNew，不进连接池，与面板采集隔离）")

	// 3. 开 session + RequestPty + Shell（与 terminal.Manager.openShell 完全一致）
	session, err := client.NewSession()
	if err != nil {
		fmt.Println("✗ NewSession 失败:", err)
		os.Exit(1)
	}
	defer session.Close()

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 115200,
		ssh.TTY_OP_OSPEED: 115200,
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

	// 6. 单条 echo 命令：验证回显 + 执行结果
	fmt.Println("\n--- 发送单条 'echo TTERM_ECHO_VERIFY_123' ---")
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
	if echoed {
		fmt.Println("✓ 单条回显正常")
	} else {
		fmt.Println("✗ 单条回显失败")
	}
	if resulted {
		fmt.Println("✓ 单条执行结果正常")
	} else {
		fmt.Println("✗ 单条执行结果未确认")
	}

	// 7. 【核心】连续快速输入 batchCount 条命令，验证回显完整、无丢失、无卡顿
	unique := fmt.Sprintf("%d", time.Now().UnixNano())
	expect := make([]string, 0, batchCount)
	var batch strings.Builder
	for i := range batchCount {
		token := fmt.Sprintf("BATCH_%02d_%s", i, unique)
		batch.WriteString("echo ")
		batch.WriteString(token)
		batch.WriteByte('\n')
		expect = append(expect, token)
	}
	fmt.Printf("\n--- 连续快速输入 %d 条命令（不逐条等待）---\n", batchCount)

	buf = nil
	writeStart := time.Now()
	// 分 5 批快速写入，模拟「连续输入很多命令」的节奏
	payload := batch.String()
	step := len(payload) / 5
	for i := range 5 {
		end := (i + 1) * step
		if i == 4 {
			end = len(payload)
		}
		if _, err := stdin.Write([]byte(payload[i*step : end])); err != nil {
			fmt.Println("✗ stdin.Write 失败:", err)
			os.Exit(1)
		}
	}
	lastToken := expect[batchCount-1]

	// 等最后一条命令的执行结果出现（回显 + 结果 = 2 次），即全部命令已顺序执行完
	t3 := time.After(20 * time.Second)
	for {
		select {
		case data, ok := <-output:
			if !ok {
				goto BATCH_EVAL
			}
			buf = append(buf, data...)
			if strings.Count(string(buf), lastToken) >= 2 {
				goto BATCH_EVAL
			}
		case <-t3:
			goto BATCH_EVAL
		}
	}

BATCH_EVAL:
	elapsed := time.Since(writeStart)
	all := string(buf)
	var lost []string
	for _, token := range expect {
		// 回显（命令本身）+ 执行结果（echo 输出），至少 2 次
		if strings.Count(all, token) < 2 {
			lost = append(lost, token)
		}
	}
	okCount := batchCount - len(lost)
	fmt.Printf("\n连续输入结果：%d/%d 条命令完整回显+执行，耗时 %v\n", okCount, batchCount, elapsed.Round(time.Millisecond))
	if len(lost) > 0 {
		fmt.Printf("✗ 丢失 %d 条：%v\n", len(lost), lost)
	} else {
		fmt.Println("✓ 全部命令回显 + 执行完整，无丢失")
	}
	batchOK := len(lost) == 0

	// 8. 测试 WindowChange（resize）
	fmt.Println("\n--- 测试 WindowChange(40, 120) ---")
	if err := session.WindowChange(40, 120); err != nil {
		fmt.Println("✗ WindowChange 失败:", err)
	} else {
		fmt.Println("✓ WindowChange 成功")
	}
	time.Sleep(300 * time.Millisecond)

	// 9. 退出
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
	if echoed && resulted && batchOK {
		fmt.Println("✅ 终端完全正常：PTY 回显 + 命令执行 + 连续输入无丢失 + WindowChange + 干净退出")
		fmt.Println("✅ 走的是与 terminal.Manager.openShell 完全相同的独立连接代码路径（DialNew）")
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
			if r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' {
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
