//go:build darwin

package localsys

import (
	"os"
	"testing"
)

func TestResolveNginxBinFindsHomebrewWhenPATHLean(t *testing.T) {
	if !nginxExistsAtCommonPaths() {
		t.Skip("nginx not installed at common Homebrew paths")
	}

	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	bin := resolveNginxBin()
	if bin == "" {
		t.Fatal("resolveNginxBin returned empty under GUI-like PATH")
	}
	if _, err := os.Stat(bin); err != nil {
		t.Fatalf("resolved bin not usable: %s: %v", bin, err)
	}
}

func TestCollectNginxInstalledWhenPATHLean(t *testing.T) {
	if !nginxExistsAtCommonPaths() {
		t.Skip("nginx not installed at common Homebrew paths")
	}

	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	info, err := CollectNginx()
	if err != nil {
		t.Fatal(err)
	}
	if !info.Installed {
		t.Fatal("CollectNginx.Installed=false under GUI-like PATH")
	}
	if info.Version == "" {
		t.Fatal("expected non-empty Version")
	}
}

func nginxExistsAtCommonPaths() bool {
	for _, c := range []string{
		"/opt/homebrew/bin/nginx",
		"/opt/homebrew/opt/nginx/bin/nginx",
		"/usr/local/bin/nginx",
		"/usr/local/opt/nginx/bin/nginx",
	} {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return true
		}
	}
	return false
}
