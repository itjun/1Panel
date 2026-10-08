package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/scrypt"
)

// 加密私钥文件格式：首行魔数，次行 base64(salt | nonce | AES-256-GCM 密文)。
// 密钥由口令经 scrypt(N=2^17, r=8, p=1) 派生。
const (
	encKeyMagic   = "1panel-update-key-v1"
	encSaltSize   = 16
	passphraseEnv = "UPDATE_KEY_PASSPHRASE"
)

func deriveKey(passphrase string, salt []byte) ([]byte, error) {
	return scrypt.Key([]byte(passphrase), salt, 1<<17, 8, 1, 32)
}

func encryptKeyText(plain, passphrase string) (string, error) {
	salt := make([]byte, encSaltSize)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := deriveKey(passphrase, salt)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(strings.TrimSpace(plain)), []byte(encKeyMagic))
	blob := append(append(salt, nonce...), sealed...)
	return encKeyMagic + "\n" + base64.StdEncoding.EncodeToString(blob) + "\n", nil
}

func decryptKeyText(enc, passphrase string) (string, error) {
	magic, body, ok := strings.Cut(strings.TrimSpace(enc), "\n")
	if !ok || strings.TrimSpace(magic) != encKeyMagic {
		return "", errors.New("不是加密私钥文件")
	}
	blob, err := base64.StdEncoding.DecodeString(strings.TrimSpace(body))
	if err != nil {
		return "", errors.New("加密私钥内容损坏")
	}
	if len(blob) < encSaltSize+12 {
		return "", errors.New("加密私钥内容过短")
	}
	key, err := deriveKey(passphrase, blob[:encSaltSize])
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	rest := blob[encSaltSize:]
	plain, err := gcm.Open(nil, rest[:gcm.NonceSize()], rest[gcm.NonceSize():], []byte(encKeyMagic))
	if err != nil {
		return "", errors.New("口令错误或文件被篡改，无法解密私钥")
	}
	return string(plain), nil
}

func readPassphrase() (string, error) {
	p := os.Getenv(passphraseEnv)
	if strings.TrimSpace(p) == "" {
		return "", fmt.Errorf("未设置环境变量 %s", passphraseEnv)
	}
	return p, nil
}

func cmdEncryptKey(args []string) error {
	fs := flag.NewFlagSet("encrypt-key", flag.ExitOnError)
	in := fs.String("in", "", "明文私钥文件")
	out := fs.String("out", "release/update_sign.key.enc", "加密后输出文件")
	_ = fs.Parse(args)
	if *in == "" {
		return errors.New("缺少 -in")
	}
	pass, err := readPassphrase()
	if err != nil {
		return err
	}
	if len(pass) < 16 {
		return errors.New("口令至少 16 个字符")
	}
	plain, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	enc, err := encryptKeyText(string(plain), pass)
	if err != nil {
		return err
	}
	if back, err := decryptKeyText(enc, pass); err != nil || back != strings.TrimSpace(string(plain)) {
		return errors.New("加密自检失败")
	}
	return os.WriteFile(*out, []byte(enc), 0o644)
}
