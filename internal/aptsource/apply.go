package aptsource

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Apply 备份、改写已知归档 URI，然后 apt-get update。
func Apply(req ApplyReq) (ApplyResult, error) {
	snap, err := Collect()
	if err != nil {
		return ApplyResult{}, err
	}
	if !snap.Distro.Apt {
		return ApplyResult{}, fmt.Errorf("仅支持 apt（Debian / Ubuntu）")
	}
	if snap.Distro.Codename == "" {
		return ApplyResult{}, fmt.Errorf("无法识别 VERSION_CODENAME")
	}
	target, name, err := resolveTarget(snap.Distro.ID, req)
	if err != nil {
		return ApplyResult{}, err
	}

	bak := filepath.Join("/etc/apt", fmt.Sprintf("sources.bak.%d", time.Now().Unix()))
	res := ApplyResult{
		BackupDir: bak,
		Mirror:    target.Host,
		Name:      name,
	}
	for _, f := range snap.Files {
		next := RewriteContent(f.Content, snap.Distro.ID, f.Path, target)
		if next == f.Content {
			continue
		}
		if err := os.MkdirAll(bak, 0o755); err != nil {
			return res, err
		}
		rel := strings.TrimPrefix(f.Path, "/etc/apt/")
		dst := filepath.Join(bak, filepath.Base(rel))
		if err := os.WriteFile(dst, []byte(f.Content), 0o644); err != nil {
			return res, fmt.Errorf("备份失败: %w", err)
		}
		if err := os.WriteFile(f.Path, []byte(next), 0o644); err != nil {
			return res, fmt.Errorf("写入 %s 失败: %w", f.Path, err)
		}
		res.Changed++
	}
	if res.Changed == 0 {
		return ApplyResult{Mirror: target.Host, Name: name}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "apt-get", "update")
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	out, err := cmd.CombinedOutput()
	res.UpdateOut = trimOut(string(out))
	if err != nil {
		// 源文件已改写成功；update 失败通常是第三方源（签名过期/失效）
		// 等与换源无关的问题，带输出尾部提示即可，不再整体报失败。
		res.UpdateFailed = true
		res.UpdateErr = trimOut(fmt.Sprintf("apt-get update 失败: %v\n%s", err, tailOut(string(out), 400)))
	}
	return res, nil
}

func resolveTarget(distroID string, req ApplyReq) (Mirror, string, error) {
	if req.Official {
		m, ok := mirrorByID(distroID, IDOfficial)
		if !ok {
			return Mirror{}, "", fmt.Errorf("无官方源")
		}
		return m, m.Name, nil
	}
	id := strings.TrimSpace(req.Mirror)
	if id == "" {
		return Mirror{}, "", fmt.Errorf("未指定镜像")
	}
	m, ok := mirrorByID(distroID, id)
	if !ok {
		return Mirror{}, "", fmt.Errorf("未知镜像: %s", id)
	}
	return m, m.Name, nil
}

func trimOut(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 4000 {
		return s[:4000] + "…"
	}
	return s
}

// tailOut 取输出尾部约 n 字符（按行边界），apt 的 E:/W: 错误行集中在末尾。
func tailOut(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	cut := s[len(s)-n:]
	if i := strings.IndexByte(cut, '\n'); i >= 0 {
		cut = cut[i+1:]
	}
	return cut
}
