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
	changed := 0
	for _, f := range snap.Files {
		next := RewriteContent(f.Content, snap.Distro.ID, f.Path, target)
		if next == f.Content {
			continue
		}
		if err := os.MkdirAll(bak, 0o755); err != nil {
			return ApplyResult{}, err
		}
		rel := strings.TrimPrefix(f.Path, "/etc/apt/")
		dst := filepath.Join(bak, filepath.Base(rel))
		if err := os.WriteFile(dst, []byte(f.Content), 0o644); err != nil {
			return ApplyResult{}, fmt.Errorf("备份失败: %w", err)
		}
		if err := os.WriteFile(f.Path, []byte(next), 0o644); err != nil {
			return ApplyResult{}, fmt.Errorf("写入 %s 失败: %w", f.Path, err)
		}
		changed++
	}
	if changed == 0 {
		return ApplyResult{Mirror: target.Host, Name: name, Changed: 0}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "apt-get", "update")
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	out, err := cmd.CombinedOutput()
	res := ApplyResult{
		BackupDir: bak,
		Mirror:    target.Host,
		Name:      name,
		Changed:   changed,
		UpdateOut: trimOut(string(out)),
	}
	if err != nil {
		return res, fmt.Errorf("apt-get update 失败: %w", err)
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
