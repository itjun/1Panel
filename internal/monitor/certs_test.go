package monitor

import (
	"testing"
	"time"
)

// 模拟脚本输出：两张证书 + 一个私钥文件（cert=0）
const certsScriptOut = `=FILE=
name=example.com.pem
size=3568
mtime=1723680000
cert=1
=TEXT=
Certificate:
    Data:
        Version: 3 (0x2)
        Issuer: C = US, O = Let's Encrypt, CN = R3
        Validity
            Not Before: Jul 17 00:00:00 2025 GMT
            Not After : Oct 15 00:00:00 2025 GMT
        Subject: CN = example.com
        X509v3 extensions:
            X509v3 Subject Alternative Name:
                DNS:example.com, DNS:*.example.com
=ENDTEXT=
=FILE=
name=example.com.key
size=1704
mtime=1723680000
cert=0
=FILE=
name=self.pem
size=1234
mtime=1723680000
cert=1
=TEXT=
Certificate:
    Data:
        Version: 3 (0x2)
        Issuer: CN = self, O = Self
        Validity
            Not Before: Jan  1 00:00:00 2025 GMT
            Not After : Dec 31 23:59:59 2035 GMT
        Subject: CN = self
=ENDTEXT=`

func TestParseCertsOutput(t *testing.T) {
	now := time.Date(2025, 8, 15, 0, 0, 0, 0, time.UTC)
	result, allFiles := parseCertsOutput(certsScriptOut, now)

	if !result.Installed {
		t.Fatal("应为已安装（目录存在）")
	}
	if len(result.Certs) != 2 {
		t.Fatalf("应识别 2 张证书，实际 %d", len(result.Certs))
	}
	// 排序后 example.com.pem 在前
	first, second := result.Certs[0], result.Certs[1]
	if first.Name != "example.com.pem" || second.Name != "self.pem" {
		t.Fatalf("排序错误: %s, %s", first.Name, second.Name)
	}

	if first.Domains[0] != "example.com" || len(first.Domains) != 2 || first.Domains[1] != "*.example.com" {
		t.Errorf("域名解析错误: %v", first.Domains)
	}
	if first.Issuer != "R3" {
		t.Errorf("颁发者应为 R3，实际 %q", first.Issuer)
	}
	if first.SelfSigned {
		t.Error("CA 颁发的证书不应判定为自签名")
	}
	if !first.HasKey || first.KeyName != "example.com.key" {
		t.Errorf("应匹配到 example.com.key，实际 hasKey=%v key=%q", first.HasKey, first.KeyName)
	}
	// 2025-10-15 距 2025-08-15 剩 61 天
	if first.DaysLeft != 61 {
		t.Errorf("剩余天数应为 61，实际 %d", first.DaysLeft)
	}
	if first.Size != 3568 || first.Mtime != 1723680000 {
		t.Errorf("size/mtime 解析错误: %d %d", first.Size, first.Mtime)
	}

	if !second.SelfSigned {
		t.Error("颁发者 CN == 使用者 CN 应判定为自签名")
	}
	if second.HasKey {
		t.Error("没有同名 .key，不应判定有私钥")
	}

	if !allFiles["example.com.key"] || len(allFiles) != 3 {
		t.Errorf("全部文件集合错误: %v", allFiles)
	}
}

func TestParseCertsOutputNoDir(t *testing.T) {
	result, _ := parseCertsOutput("=NODIR=\n", time.Now())
	if result.Installed || len(result.Certs) != 0 {
		t.Fatalf("目录不存在时 installed 应为 false，certs 为空: %+v", result)
	}
}

func TestParseCertsOutputNoOpenssl(t *testing.T) {
	result, _ := parseCertsOutput("=NOSSL=\n", time.Now())
	if !result.Installed || !result.NoOpenssl {
		t.Fatalf("缺 openssl 时 noOpenssl 应为 true: %+v", result)
	}
}

// openssl 1.0 的斜杠 DN 格式
const certOldFormatOut = `=FILE=
name=old.pem
size=100
mtime=1
cert=1
=TEXT=
Certificate:
    Data:
        Issuer: /C=US/O=Old CA/CN=Old Root
        Validity
            Not After : Aug 15 12:00:00 2026 GMT
        Subject: /C=CN/CN=old.example.com
=ENDTEXT=`

func TestParseCertsOldDNFormat(t *testing.T) {
	result, _ := parseCertsOutput(certOldFormatOut, time.Now())
	if len(result.Certs) != 1 {
		t.Fatalf("应识别 1 张证书，实际 %d", len(result.Certs))
	}
	c := result.Certs[0]
	if c.Issuer != "Old Root" {
		t.Errorf("旧格式颁发者解析错误: %q", c.Issuer)
	}
	if len(c.Domains) != 1 || c.Domains[0] != "old.example.com" {
		t.Errorf("旧格式域名解析错误: %v", c.Domains)
	}
}
