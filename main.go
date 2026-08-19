package main

import (
	"embed"
	"log"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
