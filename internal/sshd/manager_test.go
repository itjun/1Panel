package sshd

import (
	"net"
	"sync"
	"testing"
	"time"
)

// 模拟「握手挂死」：accept TCP 后永不发 SSH 握手数据
func startHangSSHServer(t *testing.T) (addr string, closeFn func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	done := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-done:
					return
				default:
					return
				}
			}
			// 故意不关闭、不读不写，模拟半开/卡死握手
			go func(c net.Conn) {
				<-done
				_ = c.Close()
			}(conn)
		}
	}()
	return ln.Addr().String(), func() {
		close(done)
		_ = ln.Close()
		wg.Wait()
	}
}

// 回归：dial 挂死时不得阻塞其它 host 的 Get（旧实现在 dial 全程持锁，会把 127.0.0.1 也拖死）
func TestGetDoesNotHoldLockDuringDial(t *testing.T) {
	hangAddr, closeHang := startHangSSHServer(t)
	defer closeHang()

	hangHost, hangPort, err := net.SplitHostPort(hangAddr)
	if err != nil {
		t.Fatal(err)
	}

	m := NewManager()

	// 后台：向会挂死的地址发起连接（应在 handshakeTimeout 后失败，但期间不能锁死 Manager）
	var hangErr error
	var hangWG sync.WaitGroup
	hangWG.Add(1)
	go func() {
		defer hangWG.Done()
		_, hangErr = m.Get("hang-host", ConnectOption{
			Host:     "hang-host",
			HostName: hangHost,
			User:     "root",
			Port:     hangPort,
			Password: "x",
		})
	}()

	// 给挂死 dial 一点启动时间
	time.Sleep(100 * time.Millisecond)

	// 并行：连一个立即拒绝的地址，必须快速返回错误（旧 bug：会一直等 hang dial 放锁）
	start := time.Now()
	_, err = m.Get("local-refuse", ConnectOption{
		Host:     "local-refuse",
		HostName: "127.0.0.1",
		User:     "root",
		Port:     "1", // 几乎必定 connection refused
		Password: "x",
	})
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Fatalf("Get(127.0.0.1:1) 被挂死 dial 阻塞了 %v（期望 <2s 快速失败）", elapsed)
	}
	if err == nil {
		t.Fatal("期望 connection refused 类错误，却成功了")
	}

	// 等挂死 dial 结束（应被 handshake 超时杀掉）
	done := make(chan struct{})
	go func() {
		hangWG.Wait()
		close(done)
	}()
	select {
	case <-done:
		if hangErr == nil {
			t.Fatal("挂死服务上的 dial 不应成功")
		}
	case <-time.After(handshakeTimeout + 5*time.Second):
		t.Fatal("挂死 dial 未在 handshakeTimeout 内返回")
	}
}

func TestDialHandshakeTimeout(t *testing.T) {
	hangAddr, closeHang := startHangSSHServer(t)
	defer closeHang()

	host, port, err := net.SplitHostPort(hangAddr)
	if err != nil {
		t.Fatal(err)
	}

	m := NewManager()
	start := time.Now()
	_, err = m.Get("h", ConnectOption{
		Host:     "h",
		HostName: host,
		User:     "u",
		Port:     port,
		Password: "p",
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("期望握手超时失败")
	}
	// 应约在 handshakeTimeout 附近，允许少量调度误差
	if elapsed < handshakeTimeout-2*time.Second {
		t.Fatalf("返回过快 %v，可能不是超时路径: %v", elapsed, err)
	}
	if elapsed > handshakeTimeout+5*time.Second {
		t.Fatalf("超时控制失效，耗时 %v: %v", elapsed, err)
	}
}
