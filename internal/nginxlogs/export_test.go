package nginxlogs

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func testSSH(t *testing.T, run func(ssh.Channel)) *ssh.Client {
	t.Helper()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(key)
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		server, channels, requests, err := ssh.NewServerConn(conn, config)
		if err != nil {
			conn.Close()
			return
		}
		defer server.Close()
		go ssh.DiscardRequests(requests)
		for incoming := range channels {
			channel, requests, err := incoming.Accept()
			if err != nil {
				return
			}
			go func() {
				defer channel.Close()
				for request := range requests {
					if request.Type == "exec" {
						request.Reply(true, nil)
						go ssh.DiscardRequests(requests)
						run(channel)
						return
					}
					request.Reply(false, nil)
				}
			}()
		}
	}()
	client, err := ssh.Dial("tcp", listener.Addr().String(), &ssh.ClientConfig{
		User: "test", HostKeyCallback: ssh.InsecureIgnoreHostKey(), Timeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	return client
}

func finish(channel ssh.Channel, code uint32) {
	channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{code}))
}

func TestExportVerifiesBeforeReplacingDestination(t *testing.T) {
	payload := bytes.Repeat([]byte("archive-data"), 65536)
	digest := sha256.Sum256(payload)
	for _, test := range []struct {
		name, checksum string
		code           uint32
		ok             bool
	}{
		{"complete", hex.EncodeToString(digest[:]), 0, true},
		{"corrupt", strings.Repeat("0", 64), 0, false},
		{"failed", hex.EncodeToString(digest[:]), 1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := testSSH(t, func(channel ssh.Channel) {
				go io.Copy(io.Discard, channel)
				json.NewEncoder(channel.Stderr()).Encode(Progress{Phase: "checked", Required: uint64(len(payload))})
				channel.Write(payload)
				json.NewEncoder(channel.Stderr()).Encode(Progress{Phase: "complete", Total: uint64(len(payload)), SHA256: test.checksum})
				finish(channel, test.code)
			})
			dir := t.TempDir()
			path := filepath.Join(dir, "logs.tar.zst")
			os.WriteFile(path, []byte("existing"), 0600)
			err := Export(context.Background(), client, "/var/log/nginx", "/var/tmp", path, nil)
			if (err == nil) != test.ok {
				t.Fatalf("result: %v", err)
			}
			got, _ := os.ReadFile(path)
			want := []byte("existing")
			if test.ok {
				want = payload
			}
			if !bytes.Equal(got, want) {
				t.Fatal("incorrect destination contents")
			}
			entries, _ := os.ReadDir(dir)
			if len(entries) != 1 {
				t.Fatalf("partial files remain: %v", entries)
			}
		})
	}
}

func TestCancelOnlyClosesExportSession(t *testing.T) {
	started := make(chan struct{}, 2)
	client := testSSH(t, func(channel ssh.Channel) {
		started <- struct{}{}
		io.Copy(io.Discard, channel)
	})
	ctx, cancel := context.WithCancel(context.Background())
	dir := t.TempDir()
	done := make(chan error, 1)
	go func() {
		done <- Export(ctx, client, "/var/log/nginx", "/var/tmp", filepath.Join(dir, "out.tar.zst"), nil)
	}()
	<-started
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected cancellation")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancellation hung")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("partial files remain: %v", entries)
	}
	session, err := client.NewSession()
	if err != nil {
		t.Fatalf("shared SSH connection was closed: %v", err)
	}
	defer session.Close()
	if err := session.Start("other-session"); err != nil {
		t.Fatal(err)
	}
}

func TestRemoteSpaceFailurePreservesLocalFile(t *testing.T) {
	client := testSSH(t, func(channel ssh.Channel) {
		go io.Copy(io.Discard, channel)
		json.NewEncoder(channel.Stderr()).Encode(Progress{Phase: "error", Message: "磁盘空间不足"})
		finish(channel, 1)
	})
	path := filepath.Join(t.TempDir(), "out.tar.zst")
	os.WriteFile(path, []byte("existing"), 0600)
	err := Export(context.Background(), client, "/var/log/nginx", "/var/tmp", path, nil)
	if err == nil || !strings.Contains(err.Error(), "磁盘空间不足") {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "existing" {
		t.Fatal("existing file overwritten")
	}
}

func TestCommandQuotesPathsAndRejectsRoot(t *testing.T) {
	for _, path := range []string{"", "relative", "/", "/tmp\x00evil"} {
		if _, err := Command(path, "/var/tmp"); err == nil {
			t.Fatalf("accepted %q", path)
		}
	}
	path := "/var/log/it's $(touch nope)\n日志"
	out, err := exec.Command("sh", "-c", "printf %s "+quote(path)).Output()
	if err != nil || string(out) != path {
		t.Fatalf("quote round trip: %q %v", out, err)
	}
}

func TestPythonWorker(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 is required for worker tests")
	}
	if _, err := exec.LookPath("zstd"); err != nil {
		t.Skip("zstd is required for worker tests")
	}
	command := exec.Command(python, "-B", "-m", "unittest", "discover", "-s", ".", "-p", "*_test.py")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatal(fmt.Sprintf("%v\n%s", err, output))
	}
}

// 一起走真实的 Python 压缩、二进制 SSH 传输、进度和校验。
// 为了让测试可移植，Linux 文件系统能力探测被替换掉。
func TestExportWithRealWorker(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 is required")
	}
	zstd, err := exec.LookPath("zstd")
	if err != nil {
		t.Skip("zstd is required")
	}
	root, remoteTemp, local := t.TempDir(), t.TempDir(), t.TempDir()
	content := bytes.Repeat([]byte(time.Now().Format("2006/01/02 15:04:05")+" [info] today's request\n"), 8192)
	old := []byte(time.Now().AddDate(0, 0, -1).Format("2006/01/02 15:04:05") + " [info] yesterday\n")
	originalContent := append(append([]byte{}, old...), content...)
	os.WriteFile(filepath.Join(root, "access.log"), originalContent, 0600)
	os.WriteFile(filepath.Join(root, "error.log"), []byte("undated traceback\n"), 0600)
	os.WriteFile(filepath.Join(root, "access.log.1"), []byte("whole rotated log"), 0600)
	os.WriteFile(filepath.Join(root, "error.log.2"), []byte("today content in yesterday modified file"), 0600)
	yesterday := time.Now().AddDate(0, 0, -1)
	if err := os.Chtimes(filepath.Join(root, "error.log.2"), yesterday, yesterday); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(root, "access.log.2.gz"), []byte("historical archive"), 0600)
	code := strings.Replace(worker, "        check_environment(parent)", "        pass # 可移植测试", 1)
	code = strings.Replace(code, `lock_parent="/tmp"`, "lock_parent="+quote(remoteTemp), 1)
	client := testSSH(t, func(channel ssh.Channel) {
		command := exec.Command(python, "-u", "-c", code, root, remoteTemp)
		input, err := command.StdinPipe()
		if err != nil {
			t.Error(err)
			finish(channel, 1)
			return
		}
		defer input.Close()
		go io.Copy(input, channel)
		command.Stdout = channel
		command.Stderr = channel.Stderr()
		if err := command.Run(); err != nil {
			t.Error(err)
			finish(channel, 1)
			return
		}
		finish(channel, 0)
	})
	path := filepath.Join(local, "logs.tar.zst")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := Export(ctx, client, root, remoteTemp, path, nil); err != nil {
		t.Fatal(err)
	}
	decoded, err := exec.Command(zstd, "-d", "-c", path).Output()
	if err != nil {
		t.Fatal(err)
	}
	archive := tar.NewReader(bytes.NewReader(decoded))
	header, err := archive.Next()
	if err != nil || header.Name != "access.log" {
		t.Fatalf("archive header: %v %v", header, err)
	}
	got, err := io.ReadAll(archive)
	if err != nil || !bytes.Equal(got, originalContent) {
		t.Fatalf("archive content mismatch: %v", err)
	}
	original, _ := os.ReadFile(filepath.Join(root, "access.log"))
	if !bytes.Equal(original, originalContent) {
		t.Fatal("source was changed")
	}
	header, err = archive.Next()
	if err != nil || header.Name != "access.log.1" {
		t.Fatalf("rotated log header: %v %v", header, err)
	}
	got, err = io.ReadAll(archive)
	if err != nil || string(got) != "whole rotated log" {
		t.Fatalf("rotated log content mismatch: %v", err)
	}
	header, err = archive.Next()
	if err != nil || header.Name != "error.log" {
		t.Fatalf("error log header: %v %v", header, err)
	}
	got, err = io.ReadAll(archive)
	if err != nil || string(got) != "undated traceback\n" {
		t.Fatalf("error log content mismatch: %v", err)
	}
	if _, err := archive.Next(); err != io.EOF {
		t.Fatalf("unexpected historical archive: %v", err)
	}
	entries, _ := filepath.Glob(filepath.Join(remoteTemp, "1panel-nginx-*"))
	if len(entries) != 0 {
		t.Fatalf("remote archive was not removed: %v", entries)
	}
}
