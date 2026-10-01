package agentinstall

import (
	"os/exec"
	"strings"
	"testing"
)

func TestCtlScriptSyntax(t *testing.T) {
	for _, mode := range []string{InitSystemd, InitSupervisor} {
		script := ctlScriptFor(mode)
		if !strings.Contains(script, "MODE="+mode+"\n") {
			t.Fatalf("%s: MODE 未替换", mode)
		}
		cmd := exec.Command("sh", "-n")
		cmd.Stdin = strings.NewReader(script)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: sh -n 失败: %v\n%s", mode, err, out)
		}
	}
}

func TestCtlScriptNoHeredocTerminator(t *testing.T) {
	for _, line := range strings.Split(ctlTemplate, "\n") {
		if strings.TrimSpace(line) == "SPANEL_CTL" {
			t.Fatal("控制脚本里不能出现单独一行 SPANEL_CTL")
		}
	}
}

func TestCtlScriptUnknownModeFallsBack(t *testing.T) {
	if !strings.Contains(ctlScriptFor("whatever"), "MODE=supervisor\n") {
		t.Fatal("未知方式应回退为 supervisor")
	}
}
