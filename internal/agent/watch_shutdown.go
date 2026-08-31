package agent

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var screenNameRE = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

// stopAppInstance 直接 SIGKILL 进程并 quit screen
func stopAppInstance(port, pid int, screen string) (bool, error) {
	if pid <= 0 && port > 0 {
		pid = pidForListenPort(port)
	}
	if pid <= 0 && port <= 0 && screen == "" {
		return false, fmt.Errorf("无 PID/端口/screen，无法下线")
	}

	if pid > 0 {
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
	quitScreen(screen)

	stopped := true
	if port > 0 {
		time.Sleep(time.Second)
		if isPortListening(port) {
			stopped = false
		}
	}
	return stopped, nil
}

func isPortListening(port int) bool {
	out, err := exec.Command("ss", "-tln").CombinedOutput()
	if err != nil {
		return false
	}
	needle := fmt.Sprintf(":%d", port)
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, needle) {
			fields := strings.Fields(line)
			if len(fields) >= 4 {
				local := fields[3]
				if strings.HasSuffix(local, needle) || strings.Contains(local, needle) {
					return true
				}
			}
		}
	}
	return false
}

func pidForListenPort(port int) int {
	out, err := exec.Command("ss", "-tlnp").CombinedOutput()
	if err != nil {
		return 0
	}
	needle := fmt.Sprintf(":%d", port)
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, needle) {
			continue
		}
		if idx := strings.Index(line, "pid="); idx >= 0 {
			rest := line[idx+4:]
			end := strings.IndexAny(rest, ",)")
			if end < 0 {
				end = len(rest)
			}
			pid, _ := strconv.Atoi(rest[:end])
			if pid > 0 {
				return pid
			}
		}
	}
	return 0
}

func quitScreen(screen string) {
	if screen == "" || screen == "N/A" {
		return
	}
	sessionID := screen
	if dot := strings.Index(screen, "."); dot >= 0 {
		sessionID = screen[:dot]
	}
	if !screenNameRE.MatchString(sessionID) {
		return
	}
	//nolint:gosec // sessionID 已白名单校验
	_ = exec.Command("screen", "-S", sessionID, "-X", "quit").Run()
}

func validScreenName(screen string) bool {
	if screen == "" {
		return false
	}
	sessionID := screen
	if dot := strings.Index(screen, "."); dot >= 0 {
		sessionID = screen[:dot]
	}
	return screenNameRE.MatchString(sessionID)
}
