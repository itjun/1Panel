package app

import (
	"fmt"
	"strings"
	"time"

	"diteng-pannel/internal/sshd"
)

// IsNginxInstalled 检查远程可执行文件，不把配置目录缺失或连接失败当成未安装。
func (s *Files) IsNginxInstalled(host string) (bool, error) {
	opt, err := (*App)(s).connectOptionFor(host)
	if err != nil {
		return false, err
	}
	out, err := s.sshMgr.Run(host, opt, "sh -s", sshd.RunOptions{
		Timeout: 15 * time.Second,
		Stdin: `p=$(command -v nginx 2>/dev/null)
for candidate in "$p" /usr/sbin/nginx /usr/local/sbin/nginx /usr/local/bin/nginx /usr/local/nginx/sbin/nginx /opt/nginx/sbin/nginx /opt/homebrew/bin/nginx; do
  if [ -n "$candidate" ] && [ -f "$candidate" ] && [ -x "$candidate" ]; then
    echo '=1PANEL_NGINX=installed'
    exit 0
  fi
done
echo '=1PANEL_NGINX=missing'
`,
	})
	if err != nil {
		return false, err
	}
	return parseNginxInstalled(string(out))
}

func parseNginxInstalled(output string) (bool, error) {
	for _, line := range strings.Split(output, "\n") {
		switch strings.TrimSpace(line) {
		case "=1PANEL_NGINX=installed":
			return true, nil
		case "=1PANEL_NGINX=missing":
			return false, nil
		}
	}
	return false, fmt.Errorf("未能确认 Nginx 安装状态")
}
