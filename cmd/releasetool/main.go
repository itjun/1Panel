// releasetool 生成、签名、校验应用内更新清单（latest.json）。
//
//	releasetool keygen -out update_sign.key
//	releasetool manifest -version v1.2.0 -base-url https://dl.example.com/1panel \
//	    -policy release/update-policy.json -notes-file notes.md \
//	    -asset darwin-universal=dist/1Panel-v1.2.0-mac-universal.zip \
//	    -asset windows-amd64=dist/1Panel-v1.2.0-win-amd64.zip -out latest.json
//	releasetool sign -in latest.json -out latest.json.sig   # 私钥取环境变量 UPDATE_SIGN_KEY
//	releasetool sign -key-enc release/update_sign.key.enc ... # 口令取环境变量 UPDATE_KEY_PASSPHRASE
//	releasetool encrypt-key -in update_sign.key -out release/update_sign.key.enc
//	releasetool verify -in latest.json -sig latest.json.sig [-pub <base64>]
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"diteng-pannel/internal/updater"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	var err error
	switch os.Args[1] {
	case "keygen":
		err = cmdKeygen(os.Args[2:])
	case "manifest":
		err = cmdManifest(os.Args[2:])
	case "sign":
		err = cmdSign(os.Args[2:])
	case "verify":
		err = cmdVerify(os.Args[2:])
	case "encrypt-key":
		err = cmdEncryptKey(os.Args[2:])
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "releasetool:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "用法: releasetool keygen|manifest|sign|verify|encrypt-key [参数]")
	os.Exit(2)
}

func cmdKeygen(args []string) error {
	fs := flag.NewFlagSet("keygen", flag.ExitOnError)
	out := fs.String("out", "", "私钥（base64 种子）输出文件，权限 0600")
	_ = fs.Parse(args)
	if *out == "" {
		return errors.New("缺少 -out")
	}
	if _, err := os.Stat(*out); err == nil {
		return fmt.Errorf("%s 已存在，拒绝覆盖", *out)
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	seed := base64.StdEncoding.EncodeToString(priv.Seed())
	if err := os.MkdirAll(filepath.Dir(*out), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(*out, []byte(seed+"\n"), 0o600); err != nil {
		return err
	}
	fmt.Println(base64.StdEncoding.EncodeToString(pub))
	return nil
}

type assetFlags []string

func (a *assetFlags) String() string     { return strings.Join(*a, ",") }
func (a *assetFlags) Set(v string) error { *a = append(*a, v); return nil }

type policy struct {
	MinSupportedVersion string `json:"minSupportedVersion"`
}

func cmdManifest(args []string) error {
	fs := flag.NewFlagSet("manifest", flag.ExitOnError)
	version := fs.String("version", "", "发布版本（如 v1.2.0）")
	baseURL := fs.String("base-url", "", "公开下载基地址，安装包位于 <base>/<version>/<文件名>")
	policyPath := fs.String("policy", "release/update-policy.json", "强制更新策略文件")
	notesFile := fs.String("notes-file", "", "更新说明（Markdown）文件，可选")
	out := fs.String("out", updater.ManifestName, "输出文件")
	var assets assetFlags
	fs.Var(&assets, "asset", "平台键=安装包路径，可重复")
	_ = fs.Parse(args)

	if *version == "" || *baseURL == "" || len(assets) == 0 {
		return errors.New("缺少 -version / -base-url / -asset")
	}
	m := updater.Manifest{
		Version:    updater.Canonical(*version),
		ReleasedAt: time.Now().UTC().Format(time.RFC3339),
		Assets:     map[string]updater.Asset{},
	}
	if b, err := os.ReadFile(*policyPath); err == nil {
		var p policy
		if err := json.Unmarshal(b, &p); err != nil {
			return fmt.Errorf("解析 %s 失败：%w", *policyPath, err)
		}
		m.MinSupportedVersion = strings.TrimSpace(p.MinSupportedVersion)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if *notesFile != "" {
		b, err := os.ReadFile(*notesFile)
		if err != nil {
			return err
		}
		m.Notes = strings.TrimSpace(string(b))
	}
	base := strings.TrimRight(*baseURL, "/")
	for _, spec := range assets {
		key, path, ok := strings.Cut(spec, "=")
		if !ok || key == "" || path == "" {
			return fmt.Errorf("-asset 格式应为 平台键=路径：%q", spec)
		}
		sum, size, err := hashFile(path)
		if err != nil {
			return err
		}
		name := filepath.Base(path)
		m.Assets[key] = updater.Asset{
			Name:   name,
			URL:    base + "/" + m.Version + "/" + name,
			SHA256: sum,
			Size:   size,
		}
	}
	if err := m.Validate(); err != nil {
		return err
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(*out, append(b, '\n'), 0o644)
}

func cmdSign(args []string) error {
	fs := flag.NewFlagSet("sign", flag.ExitOnError)
	in := fs.String("in", updater.ManifestName, "待签名清单")
	out := fs.String("out", updater.SignatureName, "签名输出文件")
	keyFile := fs.String("key-file", "", "明文私钥文件；为空时读环境变量 UPDATE_SIGN_KEY")
	keyEnc := fs.String("key-enc", "", "加密私钥文件，口令取环境变量 UPDATE_KEY_PASSPHRASE")
	_ = fs.Parse(args)

	keyText := os.Getenv("UPDATE_SIGN_KEY")
	switch {
	case *keyEnc != "":
		b, err := os.ReadFile(*keyEnc)
		if err != nil {
			return err
		}
		pass, err := readPassphrase()
		if err != nil {
			return err
		}
		if keyText, err = decryptKeyText(string(b), pass); err != nil {
			return err
		}
	case *keyFile != "":
		b, err := os.ReadFile(*keyFile)
		if err != nil {
			return err
		}
		keyText = string(b)
	}
	if strings.TrimSpace(keyText) == "" {
		return errors.New("未提供私钥（-key-enc、-key-file 或 UPDATE_SIGN_KEY）")
	}
	priv, err := updater.DecodePrivateKey(keyText)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	if err := os.WriteFile(*out, updater.Sign(priv, data), 0o644); err != nil {
		return err
	}
	fmt.Println("公钥:", base64.StdEncoding.EncodeToString(priv.Public().(ed25519.PublicKey)))
	return nil
}

func cmdVerify(args []string) error {
	fs := flag.NewFlagSet("verify", flag.ExitOnError)
	in := fs.String("in", updater.ManifestName, "清单")
	sigPath := fs.String("sig", updater.SignatureName, "签名")
	pubText := fs.String("pub", updater.DefaultPublicKey, "base64 公钥，默认取客户端内置公钥")
	_ = fs.Parse(args)

	pub, err := updater.DecodePublicKey(*pubText)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	sig, err := os.ReadFile(*sigPath)
	if err != nil {
		return err
	}
	m, err := updater.ParseManifest(data, sig, pub)
	if err != nil {
		return err
	}
	fmt.Printf("校验通过：%s（最低支持 %s，%d 个安装包）\n", m.Version, orDash(m.MinSupportedVersion), len(m.Assets))
	return nil
}

func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}
