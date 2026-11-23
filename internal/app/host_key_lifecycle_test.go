package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"diteng-pannel/internal/sshconfig"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func TestHostRegistrationAndDeletionManageOpenSSHKeys(t *testing.T) {
	sshPath, err := exec.LookPath("ssh")
	if err != nil {
		t.Skip("OpenSSH is required")
	}
	home := t.TempDir()
	a := newBackupTestApp(t, home)
	service := (*Hosts)(a)
	sshDir := filepath.Join(home, ".ssh")
	clientConfig := filepath.Join(sshDir, "client.conf")
	writeTestFile(t, clientConfig, "", 0600)

	userKey, userPrivateKey := newHostLifecycleSigner(t)
	keyPath := filepath.Join(sshDir, "id_ed25519")
	privatePEM, err := ssh.MarshalPrivateKey(userPrivateKey, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, keyPath, string(pem.EncodeToMemory(privatePEM)), 0600)
	writeTestFile(t, keyPath+".pub", string(ssh.MarshalAuthorizedKey(userKey.PublicKey())), 0600)

	newHostKey, _ := newHostLifecycleSigner(t)
	oldHostKey, _ := newHostLifecycleSigner(t)
	addr := startHostLifecycleServer(t, newHostKey, userKey.PublicKey())
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	knownHosts := filepath.Join(sshDir, "known_hosts")
	knownHosts2 := filepath.Join(sshDir, "known_hosts2")
	oldShared := knownhosts.Line([]string{addr, "peer.example"}, oldHostKey.PublicKey()) + "\n"
	oldHashed := knownhosts.HashHostname(knownhosts.Normalize(addr)) + " " + string(ssh.MarshalAuthorizedKey(oldHostKey.PublicKey()))
	otherPort := knownhosts.Line([]string{host}, oldHostKey.PublicKey()) + "\n"
	writeTestFile(t, knownHosts, oldShared+otherPort, 0600)
	writeTestFile(t, knownHosts2, oldHashed, 0600)

	openSSH := func() (string, error) {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, sshPath, "-F", clientConfig,
			"-o", "GlobalKnownHostsFile=none", "-o", "UserKnownHostsFile="+knownHosts+" "+knownHosts2,
			"-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
			"-i", keyPath, "-p", port, "fixture@"+host, "true").CombinedOutput()
		return string(out), err
	}
	if out, err := openSSH(); err == nil || !strings.Contains(out, "Host key verification failed") {
		t.Fatalf("OpenSSH should reject the old host key, got %v\n%s", err, out)
	}
	input := AddHostInput{Name: "debian", HostName: host, User: "fixture", Password: "wrong"}
	if _, err := service.addHost(input, port); err == nil {
		t.Fatal("registration accepted the wrong password")
	}
	if _, ok := a.panelStore.GetHost(input.Name); ok {
		t.Fatal("failed registration saved the alias")
	}
	assertHostLifecycleFile(t, knownHosts, oldShared+otherPort)
	assertHostLifecycleFile(t, knownHosts2, oldHashed)

	input.Password = "fixture-password"
	if _, err := service.addHost(input, port); err != nil {
		t.Fatal(err)
	}
	savedHost, ok := a.panelStore.GetHost(input.Name)
	if !ok || savedHost.Port != port {
		t.Fatal("registration did not save the alias and port")
	}
	peer := knownhosts.Line([]string{"peer.example"}, oldHostKey.PublicKey()) + "\n"
	assertHostLifecycleFile(t, knownHosts, peer+otherPort+knownhosts.Line([]string{addr}, newHostKey.PublicKey())+"\n")
	assertHostLifecycleFile(t, knownHosts2, "")
	if out, err := openSSH(); err != nil {
		t.Fatalf("OpenSSH should accept the registered host key, got %v\n%s", err, out)
	}
	writeTestFile(t, knownHosts, oldShared+otherPort, 0600)
	input.User = "updated-user"
	if _, err := service.addHost(input, port); err != nil {
		t.Fatalf("re-registering an existing alias: %v", err)
	}
	assertHostLifecycleFile(t, knownHosts, peer+otherPort+knownhosts.Line([]string{addr}, newHostKey.PublicKey())+"\n")
	hosts, err := sshconfig.Parse()
	if err != nil || len(hosts) != 1 || hosts[0].Name != input.Name || hosts[0].User != input.User {
		t.Fatalf("re-registration did not replace the OpenSSH config: %v, %v", hosts, err)
	}

	writeTestFile(t, knownHosts, oldShared+otherPort, 0600)
	update := UpdateHostInput{Name: input.Name, HostName: host, User: input.User, Password: "wrong", Note: "edited"}
	if _, err := service.UpdateHost(update); err == nil {
		t.Fatal("edit accepted an invalid password")
	}
	assertHostLifecycleFile(t, knownHosts, oldShared+otherPort)
	if saved, _ := a.panelStore.GetHost(input.Name); saved.Note == update.Note {
		t.Fatal("edit persisted its note despite failed authentication")
	}
	update.Password = input.Password
	if message, err := service.UpdateHost(update); err != nil || !strings.Contains(message, "已更新本机 SSH 主机指纹") {
		t.Fatalf("note-only edit should repair the host key: %q, %v", message, err)
	}
	const healthyNote = "updated with matching fingerprint"
	update.Note = healthyNote
	trustedRecord := peer + otherPort + knownhosts.Line([]string{addr}, newHostKey.PublicKey()) + " # keep original comment\n"
	writeTestFile(t, knownHosts, trustedRecord, 0600)
	if message, err := service.UpdateHost(update); err != nil || message != "" {
		t.Fatalf("a matching key should be preserved: %q, %v", message, err)
	}
	assertHostLifecycleFile(t, knownHosts, trustedRecord)
	if out, err := openSSH(); err != nil {
		t.Fatalf("OpenSSH rejected the key after editing, got %v\n%s", err, out)
	}
	if saved, _ := a.panelStore.GetHost(input.Name); saved.Note != healthyNote || saved.Port != port {
		t.Fatalf("edit saved note %q and port %q", saved.Note, saved.Port)
	}

	nextHostKey, _ := newHostLifecycleSigner(t)
	nextAddr := startHostLifecycleServer(t, nextHostKey, userKey.PublicKey())
	_, nextPort, err := net.SplitHostPort(nextAddr)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, knownHosts, trustedRecord+knownhosts.Line([]string{nextAddr}, oldHostKey.PublicKey())+"\n", 0600)
	update.NewName, update.Port = "debian-renamed", nextPort
	if message, err := service.UpdateHost(update); err != nil || !strings.Contains(message, "已更新本机 SSH 主机指纹") {
		t.Fatalf("editing the port should repair the key at the new endpoint: %q, %v", message, err)
	}
	assertHostLifecycleFile(t, knownHosts, trustedRecord+knownhosts.Line([]string{nextAddr}, nextHostKey.PublicKey())+"\n")
	if saved, ok := a.panelStore.GetHost(update.NewName); !ok || saved.Port != nextPort {
		t.Fatal("editing did not commit the new alias and port")
	}
	if _, ok := a.panelStore.GetHost(input.Name); ok {
		t.Fatal("editing left the old alias in the Panel store")
	}
	oldPort := port
	port = nextPort
	if out, err := openSSH(); err != nil {
		t.Fatalf("OpenSSH rejected the key at the new port, got %v\n%s", err, out)
	}
	if err := service.DeleteHost(update.NewName); err != nil {
		t.Fatal(err)
	}
	assertHostLifecycleFile(t, knownHosts, trustedRecord)
	assertHostLifecycleFile(t, knownHosts2, "")
	hosts, err = sshconfig.Parse()
	if err != nil || len(hosts) != 0 {
		t.Fatalf("alias remains in OpenSSH config: %v, %v", hosts, err)
	}
	if _, ok := a.panelStore.GetHost(update.NewName); ok {
		t.Fatal("alias remains in Panel store")
	}
	if out, err := openSSH(); err == nil || !strings.Contains(out, "Host key verification failed") {
		t.Fatalf("OpenSSH should require a new trust decision after deletion, got %v\n%s", err, out)
	}
	port = oldPort
	if out, err := openSSH(); err != nil {
		t.Fatalf("OpenSSH rejected the unrelated port after deletion, got %v\n%s", err, out)
	}
}

func assertHostLifecycleFile(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || string(got) != want {
		t.Fatalf("%s = %q, %v; want %q", filepath.Base(path), got, err, want)
	}
}

func newHostLifecycleSigner(t *testing.T) (ssh.Signer, ed25519.PrivateKey) {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return signer, key
}

func startHostLifecycleServer(t *testing.T, hostKey ssh.Signer, userKey ssh.PublicKey) string {
	t.Helper()
	config := &ssh.ServerConfig{
		PasswordCallback: func(_ ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			if string(password) != "fixture-password" {
				return nil, fmt.Errorf("wrong fixture password")
			}
			return nil, nil
		},
		PublicKeyCallback: func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if string(key.Marshal()) != string(userKey.Marshal()) {
				return nil, fmt.Errorf("wrong fixture public key")
			}
			return nil, nil
		},
	}
	config.AddHostKey(hostKey)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go serveHostLifecycleSession(conn, config)
		}
	}()
	return listener.Addr().String()
}

func serveHostLifecycleSession(conn net.Conn, config *ssh.ServerConfig) {
	defer conn.Close()
	_, channels, requests, err := ssh.NewServerConn(conn, config)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(requests)
	for incoming := range channels {
		channel, channelRequests, err := incoming.Accept()
		if err != nil {
			return
		}
		for request := range channelRequests {
			_ = request.Reply(request.Type == "exec", nil)
			if request.Type == "exec" {
				_, _ = fmt.Fprintln(channel, "=PRESENT=1")
				_, _ = channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Code uint32 }{0}))
				break
			}
		}
		_ = channel.Close()
	}
}
