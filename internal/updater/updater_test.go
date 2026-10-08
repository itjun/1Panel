package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestParseCurrent(t *testing.T) {
	cases := []struct {
		in   string
		base string
		dev  bool
		ok   bool
	}{
		{"v1.0.3", "v1.0.3", false, true},
		{"1.0.3", "v1.0.3", false, true},
		{"v1.0.3-rc1", "v1.0.3-rc1", false, true},
		{"v1.0.3-5-gabc1234", "v1.0.3", true, true},
		{"v1.0.3-5-gabc1234-dirty", "v1.0.3", true, true},
		{"开发构建", "", true, false},
		{"abc1234", "", true, false},
	}
	for _, c := range cases {
		base, dev, ok := ParseCurrent(c.in)
		if base != c.base || dev != c.dev || ok != c.ok {
			t.Errorf("ParseCurrent(%q) = %q,%v,%v；期望 %q,%v,%v", c.in, base, dev, ok, c.base, c.dev, c.ok)
		}
	}
}

func TestEvaluate(t *testing.T) {
	m := &Manifest{Version: "v1.2.0", MinSupportedVersion: "v1.1.0"}
	cases := []struct {
		cur       string
		dev       bool
		hasUpdate bool
		mandatory bool
	}{
		{"v1.2.0", false, false, false},
		{"v1.3.0", false, false, false},
		{"v1.1.5", false, true, false},
		{"v1.1.0", false, true, false},
		{"v1.0.9", false, true, true},
		{"v1.1.0-rc1", false, true, true},
		{"v1.0.9", true, true, false},
	}
	for _, c := range cases {
		d := Evaluate(c.cur, c.dev, m)
		if d.HasUpdate != c.hasUpdate || d.Mandatory != c.mandatory {
			t.Errorf("Evaluate(%s, dev=%v) = %+v；期望 has=%v mandatory=%v", c.cur, c.dev, d, c.hasUpdate, c.mandatory)
		}
	}
	if d := Evaluate("v1.0.0", false, &Manifest{Version: "v1.2.0"}); !d.HasUpdate || d.Mandatory {
		t.Errorf("无 minSupportedVersion 时不应强制：%+v", d)
	}
}

func TestManifestValidate(t *testing.T) {
	m := Manifest{Version: "v1.0.0", MinSupportedVersion: "v1.1.0"}
	if err := m.Validate(); err == nil {
		t.Fatal("minSupportedVersion 高于 version 应报错")
	}
	m = Manifest{Version: "1.2.0", MinSupportedVersion: "1.0.0"}
	if err := m.Validate(); err != nil || m.Version != "v1.2.0" || m.MinSupportedVersion != "v1.0.0" {
		t.Fatalf("应补齐 v 前缀：%v %+v", err, m)
	}
}

func TestPlatformKey(t *testing.T) {
	if PlatformKey("darwin", "arm64") != "darwin-universal" ||
		PlatformKey("windows", "amd64") != "windows-amd64" ||
		PlatformKey("linux", "amd64") != "linux-amd64" ||
		PlatformKey("freebsd", "amd64") != "" {
		t.Fatal("平台键不符")
	}
}

type fixture struct {
	pub     ed25519.PublicKey
	priv    ed25519.PrivateKey
	payload []byte
	sum     string
	files   map[string][]byte
	srv     *httptest.Server
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{pub: pub, priv: priv, payload: []byte("fake-zip-payload"), files: map[string][]byte{}}
	h := sha256.Sum256(f.payload)
	f.sum = hex.EncodeToString(h[:])
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, ok := f.files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(b)
	}))
	t.Cleanup(f.srv.Close)
	f.files["/v1.2.0/pkg.zip"] = f.payload
	f.publish(t, Manifest{
		Version:             "v1.2.0",
		MinSupportedVersion: "v1.1.0",
		Assets: map[string]Asset{
			"darwin-universal": {Name: "pkg.zip", URL: f.srv.URL + "/v1.2.0/pkg.zip", SHA256: f.sum, Size: int64(len(f.payload))},
		},
	}, priv)
	return f
}

func (f *fixture) publish(t *testing.T, m Manifest, signer ed25519.PrivateKey) {
	t.Helper()
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	f.files["/latest.json"] = data
	f.files["/latest.json.sig"] = Sign(signer, data)
}

func (f *fixture) client(t *testing.T) *Client {
	return &Client{BaseURL: f.srv.URL, PublicKey: f.pub, Dir: t.TempDir()}
}

func TestFetchAndCache(t *testing.T) {
	f := newFixture(t)
	c := f.client(t)
	m, err := c.Fetch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != "v1.2.0" {
		t.Fatalf("版本不符：%s", m.Version)
	}
	f.srv.Close()
	cached, err := c.LoadCached()
	if err != nil || cached.MinSupportedVersion != "v1.1.0" {
		t.Fatalf("断网后应能读到缓存：%v %+v", err, cached)
	}
}

func TestFetchRejectsBadSignature(t *testing.T) {
	f := newFixture(t)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	f.publish(t, Manifest{Version: "v9.0.0"}, other)
	c := f.client(t)
	if _, err := c.Fetch(context.Background()); err == nil {
		t.Fatal("非法签名应被拒绝")
	}
	if _, err := c.LoadCached(); err == nil {
		t.Fatal("验签失败的清单不应写入缓存")
	}
}

func TestDownloadVerifiesChecksum(t *testing.T) {
	f := newFixture(t)
	c := f.client(t)
	a := Asset{Name: "pkg.zip", URL: f.srv.URL + "/v1.2.0/pkg.zip", SHA256: f.sum, Size: int64(len(f.payload))}
	var last int64
	p, err := c.Download(context.Background(), a, func(done, total int64) { last = done })
	if err != nil {
		t.Fatal(err)
	}
	if last != int64(len(f.payload)) {
		t.Fatalf("进度未报到 100%%：%d", last)
	}
	if b, _ := os.ReadFile(p); string(b) != string(f.payload) {
		t.Fatal("下载内容不符")
	}

	bad := a
	bad.Name = "bad.zip"
	bad.SHA256 = hex.EncodeToString(make([]byte, 32))
	if _, err := c.Download(context.Background(), bad, nil); err == nil {
		t.Fatal("sha256 不匹配应报错")
	}
	if _, err := os.Stat(filepath.Join(c.Dir, "download", "bad.zip")); !os.IsNotExist(err) {
		t.Fatal("校验失败的文件不应留下")
	}
}

func TestAssetFileName(t *testing.T) {
	if got := assetFileName(Asset{Name: "../../etc/passwd"}); got != "passwd" {
		t.Fatalf("应只保留文件名：%q", got)
	}
	if got := assetFileName(Asset{URL: "https://x.test/v1/1Panel.zip?x=1"}); got != "1Panel.zip" {
		t.Fatalf("应从 URL 取文件名：%q", got)
	}
}
