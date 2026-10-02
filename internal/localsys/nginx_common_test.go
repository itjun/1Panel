package localsys

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListConfDFilesOnlyConfD(t *testing.T) {
	confDir := filepath.Join(t.TempDir(), "nginx")
	confD := filepath.Join(confDir, "conf.d")
	for _, d := range []string{confD, filepath.Join(confDir, "servers"), filepath.Join(confDir, "sites-enabled")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{
		filepath.Join(confDir, "nginx.conf"),
		filepath.Join(confDir, "mime.types"),
		filepath.Join(confDir, "servers", "a.conf"),
		filepath.Join(confDir, "sites-enabled", "default"),
		filepath.Join(confD, "site.conf"),
		filepath.Join(confD, "gateway.conf"),
		filepath.Join(confD, ".hidden.conf"),
	} {
		if err := os.WriteFile(p, []byte("server {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	files := listConfDFiles(confD)
	names := make([]string, 0, len(files))
	for _, f := range files {
		names = append(names, f.Name)
	}
	if strings.Join(names, ",") != "gateway.conf,site.conf" {
		t.Fatalf("conf.d 以外的文件不应列出，得到 %v", names)
	}
}
