package agentcli

import (
	"errors"
	"testing"

	"diteng-pannel/internal/sshd"
)

func TestTokenReadPreservesFailureReason(t *testing.T) {
	for _, tc := range []struct {
		name, output string
		err, want    error
	}{
		{"文件缺失", "__spanel_agent_missing__", nil, ErrNotInstalled},
		{"SSH 断线", "", errors.New("handshake failed"), ErrSSHConnection},
		{"无提权权限", "", sshd.ErrNoRoot, sshd.ErrNoRoot},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tokenFromRead([]byte(tc.output), tc.err)
			if !errors.Is(err, tc.want) {
				t.Fatalf("期望 %v，得到 %v", tc.want, err)
			}
		})
	}
	if _, err := tokenFromRead(nil, nil); err == nil || errors.Is(err, ErrNotInstalled) {
		t.Fatal("空 token 应报错，不得误报未安装")
	}
	if token, err := tokenFromRead([]byte("sudo notice\ntest-token\n"), nil); err != nil || token != "test-token" {
		t.Fatal("应正确读取最后一行 token")
	}
}

func TestSameConnectOpt(t *testing.T) {
	base := sshd.ConnectOption{
		Host: "h", HostName: "192.168.60.6", User: "debian", Port: "22",
		IdentityFiles: []string{"~/.ssh/id_ed25519"},
	}
	if !sameConnectOpt(base, base) {
		t.Fatal("相同参数应判定相等")
	}
	diff := base
	diff.Password = "secret"
	if sameConnectOpt(base, diff) {
		t.Fatal("密码变化应判定不等")
	}
	diff = base
	diff.User = "root"
	if sameConnectOpt(base, diff) {
		t.Fatal("用户变化应判定不等")
	}
	diff = base
	diff.Port = "2222"
	if sameConnectOpt(base, diff) {
		t.Fatal("端口变化应判定不等")
	}
	diff = base
	diff.IdentityFiles = []string{"~/.ssh/id_rsa", "~/.ssh/id_ed25519"}
	if sameConnectOpt(base, diff) {
		t.Fatal("密钥列表变化应判定不等")
	}
}

// GetWithOpt 在凭据更新后必须换新 Client：getToken/tryHeal 的 sudo 提权用的是
// Client 冻结的连接参数，复用旧 Client 会让补填的密码永远不生效。
func TestGetWithOptSwapsStaleClient(t *testing.T) {
	p := NewPool(nil, nil)
	opt1 := sshd.ConnectOption{Host: "h", HostName: "192.168.60.6", User: "debian"}
	c1, err := p.GetWithOpt("h", opt1)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := p.GetWithOpt("h", opt1); again != c1 {
		t.Fatal("参数未变时应复用缓存 Client")
	}
	opt2 := opt1
	opt2.Password = "new-secret"
	c2, _ := p.GetWithOpt("h", opt2)
	if c2 == c1 {
		t.Fatal("密码变化后应替换为新 Client")
	}
	if c2.opt.Password != "new-secret" {
		t.Fatalf("新 Client 应携带新密码，得到 %q", c2.opt.Password)
	}
}
