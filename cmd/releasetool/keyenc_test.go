package main

import "testing"

func TestEncryptKeyRoundTrip(t *testing.T) {
	const pass = "correct horse battery staple"
	enc, err := encryptKeyText("c2VjcmV0LXNlZWQ=\n", pass)
	if err != nil {
		t.Fatal(err)
	}
	got, err := decryptKeyText(enc, pass)
	if err != nil || got != "c2VjcmV0LXNlZWQ=" {
		t.Fatalf("解密不符：%q %v", got, err)
	}
	if _, err := decryptKeyText(enc, "wrong passphrase!!"); err == nil {
		t.Fatal("错误口令应解密失败")
	}
	if _, err := decryptKeyText("garbage", pass); err == nil {
		t.Fatal("非加密文件应报错")
	}
}
