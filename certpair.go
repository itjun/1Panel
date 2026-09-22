package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"time"

	"diteng-pannel/internal/monitor"
)

// Certs 证书服务：本地证书/私钥配对校验与上传
type Certs App

// CertPairCheck 本地「证书 + 私钥」配对校验结果（不上传、不触网）
type CertPairCheck struct {
	CertPath   string   `json:"certPath"` // 识别出的证书文件路径
	KeyPath    string   `json:"keyPath"`  // 识别出的私钥文件路径
	Domains    []string `json:"domains"`  // CN + SAN 域名（去重）
	Issuer     string   `json:"issuer"`
	NotAfter   int64    `json:"notAfter"` // 到期时间（Unix 秒）
	DaysLeft   int      `json:"daysLeft"` // 剩余天数
	SelfSigned bool     `json:"selfSigned"`
}

// CheckCertPair 本地校验证书与私钥是否配对
// localPaths: 用户拖入的文件（任意顺序，自动识别哪个是证书、哪个是私钥；
// 也支持单个文件里同时包含证书和私钥两个 PEM 块）
// 只有两者公钥完全一致才返回结果，否则返回错误
func (s *Certs) CheckCertPair(localPaths []string) (CertPairCheck, error) {
	var cert *x509.Certificate
	var certPath string
	var key any
	var keyPath string

	for _, p := range localPaths {
		data, err := os.ReadFile(p)
		if err != nil {
			return CertPairCheck{}, fmt.Errorf("读取文件失败: %w", err)
		}
		rest := data
		for {
			var block *pem.Block
			block, rest = pem.Decode(rest)
			if block == nil {
				break
			}
			if cert == nil && block.Type == "CERTIFICATE" {
				c, err := x509.ParseCertificate(block.Bytes)
				if err != nil {
					return CertPairCheck{}, fmt.Errorf("证书解析失败（%s）: %w", p, err)
				}
				cert = c
				certPath = p
				continue
			}
			if key == nil && isPrivateKeyBlock(block.Type) {
				k, err := parsePrivateKeyBlock(block)
				if err != nil {
					return CertPairCheck{}, err
				}
				key = k
				keyPath = p
			}
		}
	}

	if cert == nil {
		return CertPairCheck{}, errors.New("未识别到证书（需要 PEM 格式的 CERTIFICATE 块）")
	}
	if key == nil {
		return CertPairCheck{}, errors.New("未识别到私钥（需要 PEM 格式的私钥块）")
	}

	// 公钥比对：PKIX DER 完全一致才算配对
	certPub, err := x509.MarshalPKIXPublicKey(cert.PublicKey)
	if err != nil {
		return CertPairCheck{}, fmt.Errorf("证书公钥解析失败: %w", err)
	}
	keyPub, err := x509.MarshalPKIXPublicKey(publicKeyOf(key))
	if err != nil {
		return CertPairCheck{}, fmt.Errorf("私钥公钥解析失败: %w", err)
	}
	if !bytes.Equal(certPub, keyPub) {
		return CertPairCheck{}, errors.New("私钥与证书不匹配，请确认是同一张证书的密钥对")
	}

	return CertPairCheck{
		CertPath:   certPath,
		KeyPath:    keyPath,
		Domains:    certDomains(cert),
		Issuer:     certIssuer(cert),
		NotAfter:   cert.NotAfter.Unix(),
		DaysLeft:   int(time.Until(cert.NotAfter).Hours() / 24),
		SelfSigned: cert.Subject.String() == cert.Issuer.String(),
	}, nil
}

// UploadCertPair 把已校验配对的证书+私钥上传到远程 /etc/nginx/cert
func (s *Certs) UploadCertPair(host, certPath, keyPath string) error {
	var total int64
	for _, p := range []string{certPath, keyPath} {
		info, err := os.Stat(p)
		if err != nil {
			return fmt.Errorf("本地文件不存在: %w", err)
		}
		total += info.Size()
	}

	sc, err := openSFTP(s.sshMgr, host, (*App)(s).connectOptionFor)
	if err != nil {
		return err
	}
	defer sc.Close()

	// uploadFileSc 内部会 MkdirAll，远端没有 /etc/nginx/cert 也能自动创建
	prog := &progressTracker{total: total}
	for _, p := range []string{certPath, keyPath} {
		if _, err := uploadFileSc(sc, p, monitor.CertDir, false, prog); err != nil {
			return fmt.Errorf("上传 %s 失败: %w", p, err)
		}
	}
	return nil
}

func isPrivateKeyBlock(blockType string) bool {
	switch blockType {
	case "PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY":
		return true
	}
	return false
}

func parsePrivateKeyBlock(block *pem.Block) (any, error) {
	switch block.Type {
	case "RSA PRIVATE KEY":
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	case "EC PRIVATE KEY":
		return x509.ParseECPrivateKey(block.Bytes)
	case "PRIVATE KEY":
		return x509.ParsePKCS8PrivateKey(block.Bytes)
	case "ENCRYPTED PRIVATE KEY":
		return nil, errors.New("私钥已加密（带口令），请先解密后再上传")
	}
	return nil, fmt.Errorf("不支持的私钥格式: %s", block.Type)
}

// publicKeyOf 从私钥对象提取公钥（PKCS8 解析结果可能是 rsa/ecdsa/ed25519）
func publicKeyOf(key any) any {
	switch k := key.(type) {
	case *rsa.PrivateKey:
		return &k.PublicKey
	case *ecdsa.PrivateKey:
		return &k.PublicKey
	case ed25519.PrivateKey:
		return k.Public()
	}
	return key
}

func certDomains(cert *x509.Certificate) []string {
	domains := make([]string, 0, len(cert.DNSNames)+1)
	seen := map[string]bool{}
	add := func(d string) {
		if d != "" && !seen[d] {
			seen[d] = true
			domains = append(domains, d)
		}
	}
	add(cert.Subject.CommonName)
	for _, d := range cert.DNSNames {
		add(d)
	}
	return domains
}

func certIssuer(cert *x509.Certificate) string {
	if cert.Issuer.CommonName != "" {
		return cert.Issuer.CommonName
	}
	if len(cert.Issuer.Organization) > 0 {
		return cert.Issuer.Organization[0]
	}
	return ""
}
