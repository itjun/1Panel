package app

import (
	"io/fs"
	"os"
	"testing"
)

// Package tests load the same source assets that assets.go embeds in the
// executable. No production code relies on the repository's working directory.
func testResources(t *testing.T) Resources {
	t.Helper()
	source := os.DirFS("../..")
	read := func(path string) []byte {
		t.Helper()
		data, err := fs.ReadFile(source, path)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	return Resources{
		Frontend:              source,
		AppIcon:               read("build/appicon.png"),
		SystrayTemplate:       read("build/darwin/systray-template.png"),
		SystrayColor:          read("build/windows/systray.png"),
		BootstrapZsh:          read("scripts/bootstrap-zsh.sh"),
		OhMyZsh:               read("scripts/oh-my-zsh/oh-my-zsh.tar.gz"),
		ZshAutosuggestions:    read("scripts/zsh-plugins/zsh-autosuggestions/zsh-autosuggestions.tar.gz"),
		ZshSyntaxHighlighting: read("scripts/zsh-plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.tar.gz"),
	}
}
