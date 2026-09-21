package sshd

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// startSlowKeepaliveServer 起一个真实 SSH server，但把 global request（keepalive）
// 的回复延迟 replyDelay 再回——模拟「链路真实存活、RTT 短时尖峰」的网络抖动。
// 生产上对应 Wi-Fi/VPN 卡几秒：连接没断，只是回复慢了。
func startSlowKeepaliveServer(t *testing.T, replyDelay time.Duration) (host, port string, closeFn func()) {
	t.Helper()

	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) == "x" {
				return &ssh.Permissions{}, nil
			}
			return nil, errors.New("auth failed")
		},
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	cfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				sconn, chans, reqs, err := ssh.NewServerConn(c, cfg)
				if err != nil {
					_ = c.Close()
					return
				}
				// global request：延迟回复（每个请求独立计时，避免串行排队叠加延迟）
				go func() {
					for req := range reqs {
						go func(r *ssh.Request) {
							select {
							case <-time.After(replyDelay):
								_ = r.Reply(true, nil)
							case <-done:
							}
						}(req)
					}
				}()
				// channel：接受 shell 请求但不发 exit-status，让 Wait 一直阻塞
				//（连接被杀时 Wait 才会返回，这正是前端 :exit 事件的信号源）
				go func() {
					for newCh := range chans {
						ch, reqs, err := newCh.Accept()
						if err != nil {
							continue
						}
						_ = ch
						go func(reqs <-chan *ssh.Request) {
							for req := range reqs {
								_ = req.Reply(req.Type == "shell", nil)
							}
						}(reqs)
					}
				}()
				_ = sconn
			}(conn)
		}
	}()

	h, p, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	return h, p, func() {
		close(done)
		_ = ln.Close()
	}
}

// 回归：链路抖动（keepalive 回复 2.5s 尖峰）但连接真实存活时，
// 终端心跳不得判死杀连接——杀连接会连带杀掉远端 PTY 里正在跑的进程（git 等）。
// 旧参数（2s 超时 × 2 次 ≈ 6s 判死）在 2.5s 尖峰下必然误杀，本测试曾红。
func TestTermKeepaliveSurvivesLatencySpike(t *testing.T) {
	host, port, closeFn := startSlowKeepaliveServer(t, 2500*time.Millisecond)
	defer closeFn()

	m := NewManager()
	client, keepaliveCancel, err := m.DialNewKeepalive(ConnectOption{
		Host:     "spike-host",
		HostName: host,
		User:     "u",
		Port:     port,
		Password: "x",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer keepaliveCancel()
	defer func() { _ = client.Close() }()

	// 在这条连接上开一个交互 shell，对齐真实终端会话的形态；
	// 连接被心跳误杀时 session.Wait() 会带 error 返回（生产路径：前端收到 :exit reason=error）
	sess, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	if err := sess.Shell(); err != nil {
		t.Fatal(err)
	}
	waitErr := make(chan error, 1)
	go func() { waitErr <- sess.Wait() }()

	// 观察窗口须覆盖旧参数的判死点（约 6~9s）：窗口内 shell 被杀即误杀
	select {
	case err := <-waitErr:
		t.Fatalf("链路只是 2.5s RTT 尖峰，终端连接却被心跳判死（生产后果：远端进程被连带杀死）: %v", err)
	case <-time.After(15 * time.Second):
		// 连接存活，符合预期
	}
}
