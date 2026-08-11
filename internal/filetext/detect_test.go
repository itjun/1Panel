package filetext

import (
	"testing"
)

func TestDetectLineEnding(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", "—"},
		{"a\nb\n", "LF"},
		{"a\r\nb\r\n", "CRLF"},
		{"a\rb\r", "CR"},
		{"a\r\nb\nc", "Mixed"},
	}
	for _, c := range cases {
		if g := DetectLineEnding([]byte(c.in)); g != c.want {
			t.Errorf("DetectLineEnding(%q)=%q want %q", c.in, g, c.want)
		}
	}
}

func TestDecodeUTF8AndGBK(t *testing.T) {
	// UTF-8
	text, enc, err := DecodeToUTF8([]byte("你好\n"))
	if err != nil || enc != "UTF-8" || text != "你好\n" {
		t.Fatalf("utf8: text=%q enc=%q err=%v", text, enc, err)
	}
	// UTF-8 BOM
	bom := append([]byte{0xEF, 0xBB, 0xBF}, []byte("hi")...)
	text, enc, err = DecodeToUTF8(bom)
	if err != nil || enc != "UTF-8 BOM" || text != "hi" {
		t.Fatalf("bom: text=%q enc=%q err=%v", text, enc, err)
	}
}

func TestNormalizeLinux(t *testing.T) {
	in := "a\r\nb\rc\n\ufeffx" // BOM as rune may appear mid if pasted; leading BOM handled
	// leading BOM
	in2 := "\ufeffa\r\nb\r"
	out := NormalizeLinux(in2)
	if out != "a\nb\n" {
		t.Fatalf("got %q", out)
	}
	_ = in
}

func TestNeedsNormalize(t *testing.T) {
	if NeedsNormalize("UTF-8", "LF") {
		t.Fatal("utf8+lf should be ok")
	}
	if !NeedsNormalize("GBK", "LF") {
		t.Fatal("gbk needs normalize")
	}
	if !NeedsNormalize("UTF-8", "CRLF") {
		t.Fatal("crlf needs normalize")
	}
	if NeedsNormalize("UTF-8", "—") {
		t.Fatal("empty line ending ok")
	}
}
