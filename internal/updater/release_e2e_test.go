//go:build linux

package updater

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestRealRelease 用真实发布产物端到端验证自动升级链路（默认跳过）：
//
//	ONEPANEL_UPDATE_E2E=1 go test ./internal/updater -run TestRealRelease -v
//
// 内置公钥验签官方 GitHub Releases 的 latest.json，真实下载当前平台安装包
// （约 70MB），并按 Linux 自动升级路径解包替换。换签名密钥或改打包结构后跑一次，
// 可提前发现「客户端验签不过 / 包里取不出二进制」这类只在真实发布暴露的问题。
func TestRealRelease(t *testing.T) {
	if os.Getenv("ONEPANEL_UPDATE_E2E") != "1" {
		t.Skip("设置 ONEPANEL_UPDATE_E2E=1 启用（联网下载真实安装包）")
	}
	pub, err := DecodePublicKey(DefaultPublicKey)
	if err != nil {
		t.Fatalf("内置公钥无法解析：%v", err)
	}
	c := &Client{
		BaseURL:   "https://github.com/itjun/1Panel/releases/latest/download",
		PublicKey: pub,
		Dir:       t.TempDir(),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	m, err := c.Fetch(ctx)
	if err != nil {
		t.Fatalf("拉取/验签真实清单失败：%v", err)
	}
	if err := m.Validate(); err != nil {
		t.Fatalf("真实清单不合法：%v", err)
	}
	key := CurrentPlatformKey()
	a, ok := m.AssetFor(key)
	if !ok {
		t.Fatalf("真实清单缺少当前平台资产 %s", key)
	}
	t.Logf("最新正式版 %s（%s，%d 字节）", m.Version, a.Name, a.Size)

	path, err := c.Download(ctx, a, nil)
	if err != nil {
		t.Fatalf("下载/校验真实安装包失败：%v", err)
	}

	// 按 Apply 的 Linux 路径替换一个占位二进制，验证包内能取出可执行文件。
	target := filepath.Join(t.TempDir(), "1Panel")
	if err := os.WriteFile(target, []byte("old-bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceExeFromTarGz(path, target); err != nil {
		t.Fatalf("从真实安装包解出二进制失败：%v", err)
	}
	st, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm()&0o100 == 0 {
		t.Fatal("解出的二进制应可执行")
	}
	if st.Size() < 1_000_000 {
		t.Fatalf("解出的二进制异常地小：%d 字节", st.Size())
	}

	// deb 资产（首个 deb 发布后存在）：校验是 dpkg 可解析、包名与版本正确的安装包，
	// 与 update-apply 助手实际安装的是同一份产物。
	if a, ok := m.AssetFor(UpdateAssetKey()); ok && strings.HasSuffix(a.Name, ".deb") {
		debPath, err := c.Download(ctx, a, nil)
		if err != nil {
			t.Fatalf("下载/校验真实 deb 安装包失败：%v", err)
		}
		out, err := exec.Command("dpkg-deb", "--field", debPath, "Package", "Version").CombinedOutput()
		if err != nil {
			t.Fatalf("deb 安装包解析失败：%v\n%s", err, out)
		}
		fields := string(out)
		if !strings.Contains(fields, "Package: 1panel") && !strings.Contains(fields, "Package: 1Panel") {
			t.Fatalf("deb 包名异常：\n%s", fields)
		}
		if !strings.Contains(fields, "Version: "+strings.TrimPrefix(m.Version, "v")) {
			t.Fatalf("deb 版本应与清单一致（%s）：\n%s", m.Version, fields)
		}
		t.Logf("deb 安装包校验通过（%s，%d 字节）", a.Name, a.Size)
	} else {
		t.Log("清单暂无 deb 资产（首个 deb 发布后此分支开始校验）")
	}
}
