package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 生成测试用自签名证书和私钥 PEM 文件
func writeTestCertPair(t *testing.T, dir string, cn string) (certPath, keyPath string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: cn},
		DNSNames:     []string{cn, "www." + cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(90 * 24 * time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPath = filepath.Join(dir, cn+".pem")
	keyPath = filepath.Join(dir, cn+".key")
	os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600)
	os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}), 0600)
	return
}

func TestCheckCertPairMatch(t *testing.T) {
	dir := t.TempDir()
	certPath, keyPath := writeTestCertPair(t, dir, "example.com")
	a := &App{}

	// 顺序打乱也应正确识别
	res, err := a.CheckCertPair([]string{keyPath, certPath})
	if err != nil {
		t.Fatalf("配对校验失败: %v", err)
	}
	if res.CertPath != certPath || res.KeyPath != keyPath {
		t.Errorf("证书/私钥识别错误: cert=%s key=%s", res.CertPath, res.KeyPath)
	}
	if len(res.Domains) != 2 || res.Domains[0] != "example.com" || res.Domains[1] != "www.example.com" {
		t.Errorf("域名解析错误: %v", res.Domains)
	}
	if !res.SelfSigned {
		t.Error("自签名证书应判定 SelfSigned=true")
	}
	if res.DaysLeft < 89 || res.DaysLeft > 90 {
		t.Errorf("剩余天数异常: %d", res.DaysLeft)
	}
}

func TestCheckCertPairMismatch(t *testing.T) {
	dir := t.TempDir()
	cert1, key1 := writeTestCertPair(t, dir, "a.com")
	_, key2 := writeTestCertPair(t, dir, "b.com")
	a := &App{}

	if _, err := a.CheckCertPair([]string{cert1, key2}); err == nil {
		t.Fatal("不匹配的私钥不应通过校验")
	}
	// 只传证书不传私钥
	if _, err := a.CheckCertPair([]string{cert1}); err == nil {
		t.Fatal("缺少私钥不应通过校验")
	}
	// 只传私钥
	if _, err := a.CheckCertPair([]string{key1}); err == nil {
		t.Fatal("缺少证书不应通过校验")
	}
}
