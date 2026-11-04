package updater

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// RunUpdateApply 是隐藏子命令 `1Panel update-apply` 的入口，由 applyDebViaPKExec
// 经 pkexec 以 root 运行：把已下载并通过清单验签的 .deb 复制到 root 私有目录、
// 复验清单哈希后用 dpkg 安装。全程不联网、不初始化 GUI，输出走 stderr，
// 返回值作为进程退出码。
func RunUpdateApply(args []string) int {
	if err := runUpdateApply(args); err != nil {
		fmt.Fprintln(os.Stderr, "1Panel update-apply:", err)
		return 1
	}
	return 0
}

func runUpdateApply(args []string) error {
	fs := flag.NewFlagSet("update-apply", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	deb := fs.String("deb", "", "已下载的 .deb 安装包路径")
	sum := fs.String("sha256", "", "更新清单声明的 SHA-256")
	if err := fs.Parse(args); err != nil {
		return errors.New("参数错误（用法：update-apply --deb <路径> --sha256 <哈希>）")
	}
	if *deb == "" || *sum == "" || fs.NArg() != 0 {
		return errors.New("用法：update-apply --deb <路径> --sha256 <哈希>")
	}
	if os.Geteuid() != 0 {
		return errors.New("需要 root 权限（由 pkexec 调用）")
	}
	if !filepath.IsAbs(*deb) {
		return fmt.Errorf("要求绝对路径：%s", *deb)
	}

	// 副本放在仅 root 可读的临时目录，杜绝校验与安装之间被调包
	dir, err := os.MkdirTemp("", "1panel-update-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	staged := filepath.Join(dir, "package.deb")
	if err := copyAndVerifyDeb(*deb, *sum, staged); err != nil {
		return err
	}
	if out, err := runDpkgInstall(staged); err != nil {
		return fmt.Errorf("dpkg 安装失败：%w%s", err, outputTail(string(out), 600))
	}
	return nil
}

// copyAndVerifyDeb 复制 .deb 到 dst 并边复制边计算 SHA-256，与更新清单声明的
// 期望值恒时比较，不符即失败（副本随之作废）。
func copyAndVerifyDeb(src, wantSHA256, dst string) error {
	want, err := hex.DecodeString(strings.ToLower(strings.TrimSpace(wantSHA256)))
	if err != nil || len(want) != sha256.Size {
		return fmt.Errorf("非法 SHA-256：%q", wantSHA256)
	}
	st, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("不是普通文件：%s", src)
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(out, h), in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if subtle.ConstantTimeCompare(h.Sum(nil), want) != 1 {
		return errors.New("更新包哈希与更新清单不符，拒绝安装")
	}
	return nil
}

// runDpkgInstall 以最小环境安装本地 .deb，避免提权进程继承用户环境。
func runDpkgInstall(deb string) ([]byte, error) {
	cmd := exec.Command("dpkg", "-i", "--", deb)
	cmd.Env = []string{
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		"HOME=/root",
		"LC_ALL=C",
		"DEBIAN_FRONTEND=noninteractive",
	}
	return cmd.CombinedOutput()
}

// outputTail 取输出的最后 n 个字符（保留多行），用于错误提示。
func outputTail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return "…" + s[len(s)-n:]
}
