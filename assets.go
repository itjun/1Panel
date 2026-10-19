package main

import (
	"embed"

	"diteng-pannel/internal/app"
)

// Resource paths remain relative to the repository root. The application
// receives the embedded data and never reads these files from the working directory.
//
//go:embed all:frontend/dist
var frontendAssets embed.FS

//go:embed build/appicon.png
var appIconPNG []byte

//go:embed build/darwin/systray-template.png
var systrayTemplatePNG []byte

//go:embed build/windows/systray.png
var systrayColorPNG []byte

//go:embed scripts/bootstrap-zsh.sh
var bootstrapZshScript []byte

//go:embed scripts/oh-my-zsh/oh-my-zsh.tar.gz
var ohMyZshArchive []byte

//go:embed scripts/zsh-plugins/zsh-autosuggestions/zsh-autosuggestions.tar.gz
var zshAutosuggestionsArchive []byte

//go:embed scripts/zsh-plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.tar.gz
var zshSyntaxHighlightingArchive []byte

func embeddedResources() app.Resources {
	return app.Resources{
		Frontend:              frontendAssets,
		AppIcon:               appIconPNG,
		SystrayTemplate:       systrayTemplatePNG,
		SystrayColor:          systrayColorPNG,
		BootstrapZsh:          bootstrapZshScript,
		OhMyZsh:               ohMyZshArchive,
		ZshAutosuggestions:    zshAutosuggestionsArchive,
		ZshSyntaxHighlighting: zshSyntaxHighlightingArchive,
	}
}
