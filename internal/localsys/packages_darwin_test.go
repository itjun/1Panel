//go:build darwin

package localsys

import (
	"os/exec"
	"strings"
	"testing"
)

func TestListBrewWithGUIPath(t *testing.T) {
	var brew string
	for _, candidate := range []string{"/opt/homebrew/bin/brew", "/usr/local/bin/brew"} {
		if bin, err := exec.LookPath(candidate); err == nil {
			brew = bin
			break
		}
	}
	if brew == "" {
		t.Skip("Homebrew is not installed at a standard path")
	}
	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	for _, kind := range []string{"formula", "cask"} {
		t.Run(kind, func(t *testing.T) {
			output, err := exec.Command(brew, "list", "--"+kind, "--versions").Output()
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSpace(string(output)), "\n")
			if strings.TrimSpace(string(output)) == "" {
				t.Skip("No installed packages for " + kind)
			}
			packages := listBrew(kind)
			if len(packages) != len(lines) {
				t.Fatalf("GUI PATH: %s returned %d packages, want %d", kind, len(packages), len(lines))
			}
			for _, pkg := range packages {
				if pkg.Source != kind || pkg.Path == "" {
					t.Fatalf("Invalid package: %+v", pkg)
				}
			}
		})
	}
}
