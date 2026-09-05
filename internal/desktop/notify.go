package desktop

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

// Notify 弹出本机系统通知（通知中心）。失败静默由调用方决定是否忽略。
func Notify(title, body string) error {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	if title == "" && body == "" {
		return nil
	}
	if title == "" {
		title = "diteng-pannel"
	}
	switch runtime.GOOS {
	case "darwin":
		return notifyDarwin(title, body)
	default:
		// 其它平台暂不实现：不报错，避免阻断告警主流程
		return nil
	}
}

func notifyDarwin(title, body string) error {
	// display notification 对引号敏感，用转义后的 AppleScript 字符串
	script := fmt.Sprintf(
		`display notification %s with title %s`,
		appleString(body),
		appleString(title),
	)
	cmd := exec.Command("osascript", "-e", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("系统通知失败: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// appleString 把 Go 字符串编成 AppleScript 引号字面量
func appleString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}
