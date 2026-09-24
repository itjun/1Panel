package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadLocalFilePreview(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "update.py")
	if err := os.WriteFile(path, []byte("print('hi')\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	prev, err := (*Files)(nil).ReadLocalFilePreview(path)
	if err != nil {
		t.Fatal(err)
	}
	if prev.Name != "update.py" || prev.Encoding != "UTF-8" || prev.LineEnding != "CRLF" || !prev.NeedsNormalize {
		t.Fatalf("preview=%+v", prev)
	}
	if !strings.Contains(prev.Content, "print('hi')") {
		t.Fatalf("content=%q", prev.Content)
	}
}

func TestReadLocalFilePreviewRejectsBinary(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "blob.bin")
	if err := os.WriteFile(path, []byte{0, 1, 2, 3}, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := (*Files)(nil).ReadLocalFilePreview(path); err == nil {
		t.Fatal("expected binary rejection")
	}
}
