package app

import "io/fs"

// Resources contains the compile-time assets supplied by the executable.
// Frontend retains its frontend/dist prefix for Wails and the HTTP board.
type Resources struct {
	Frontend              fs.FS
	AppIcon               []byte
	SystrayTemplate       []byte
	SystrayColor          []byte
	BootstrapZsh          []byte
	OhMyZsh               []byte
	ZshAutosuggestions    []byte
	ZshSyntaxHighlighting []byte
}
