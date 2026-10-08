// Package updater 实现应用内自动更新：拉取并验签发布清单、判定是否需要（强制）更新、
// 下载校验安装包、按平台原地替换。
package updater

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strings"

	"golang.org/x/mod/semver"
)

const (
	ManifestName  = "latest.json"
	SignatureName = "latest.json.sig"
)

// Asset 单个平台的安装包。
type Asset struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// Manifest 发布清单（latest.json），由 cmd/releasetool 生成并签名。
type Manifest struct {
	Version             string           `json:"version"`
	MinSupportedVersion string           `json:"minSupportedVersion"`
	ReleasedAt          string           `json:"releasedAt"`
	Notes               string           `json:"notes"`
	Assets              map[string]Asset `json:"assets"`
}

// Validate 检查版本号合法且 minSupportedVersion 不高于 version。
func (m *Manifest) Validate() error {
	m.Version = Canonical(m.Version)
	if !semver.IsValid(m.Version) {
		return fmt.Errorf("清单版本号非法：%q", m.Version)
	}
	if m.MinSupportedVersion != "" {
		m.MinSupportedVersion = Canonical(m.MinSupportedVersion)
		if !semver.IsValid(m.MinSupportedVersion) {
			return fmt.Errorf("minSupportedVersion 非法：%q", m.MinSupportedVersion)
		}
		if semver.Compare(m.MinSupportedVersion, m.Version) > 0 {
			return fmt.Errorf("minSupportedVersion %s 高于发布版本 %s", m.MinSupportedVersion, m.Version)
		}
	}
	for key, a := range m.Assets {
		if !strings.HasPrefix(a.URL, "https://") && !strings.HasPrefix(a.URL, "http://") {
			return fmt.Errorf("安装包 %s 地址非法：%q", key, a.URL)
		}
		if len(a.SHA256) != 64 {
			return fmt.Errorf("安装包 %s 缺少 sha256", key)
		}
	}
	return nil
}

// AssetFor 返回指定平台键的安装包。
func (m *Manifest) AssetFor(key string) (Asset, bool) {
	if m == nil || key == "" {
		return Asset{}, false
	}
	a, ok := m.Assets[key]
	return a, ok
}

// PlatformKey 平台键：macOS 发布 universal 包，其余按 GOOS-GOARCH。
func PlatformKey(goos, goarch string) string {
	switch goos {
	case "darwin":
		return "darwin-universal"
	case "windows":
		return "windows-" + goarch
	case "linux":
		return "linux-" + goarch
	default:
		return ""
	}
}

// CurrentPlatformKey 当前运行平台的平台键。
func CurrentPlatformKey() string {
	return PlatformKey(runtime.GOOS, runtime.GOARCH)
}

// ParseManifest 先验签再解析；签名为 base64 文本（允许首尾空白）。
func ParseManifest(data, sig []byte, pub ed25519.PublicKey) (*Manifest, error) {
	if err := Verify(pub, data, sig); err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("清单解析失败：%w", err)
	}
	if err := m.Validate(); err != nil {
		return nil, err
	}
	return &m, nil
}

// Sign 返回 base64 编码的 ed25519 签名。
func Sign(priv ed25519.PrivateKey, data []byte) []byte {
	return []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, data)) + "\n")
}

// Verify 校验 base64 签名。
func Verify(pub ed25519.PublicKey, data, sig []byte) error {
	if len(pub) != ed25519.PublicKeySize {
		return errors.New("未配置更新验签公钥")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil || len(raw) != ed25519.SignatureSize {
		return errors.New("清单签名格式错误")
	}
	if !ed25519.Verify(pub, data, raw) {
		return errors.New("清单签名校验失败")
	}
	return nil
}

// DecodePublicKey 解析 base64 公钥。
func DecodePublicKey(s string) (ed25519.PublicKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(s))
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, errors.New("公钥格式错误")
	}
	return ed25519.PublicKey(raw), nil
}

// DecodePrivateKey 解析 base64 私钥，接受 32 字节种子或 64 字节完整私钥。
func DecodePrivateKey(s string) (ed25519.PrivateKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(s))
	if err != nil {
		return nil, errors.New("私钥格式错误")
	}
	switch len(raw) {
	case ed25519.SeedSize:
		return ed25519.NewKeyFromSeed(raw), nil
	case ed25519.PrivateKeySize:
		return ed25519.PrivateKey(raw), nil
	default:
		return nil, errors.New("私钥长度错误")
	}
}
