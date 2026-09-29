package sysfonts

import (
	"os"
	"testing"
)

func TestParseFontFile(t *testing.T) {
	cases := []struct {
		path      string
		family    string
		monospace bool
	}{
		{path: "/System/Library/Fonts/Monaco.ttf", family: "Monaco", monospace: true},
		{path: "/System/Library/Fonts/Menlo.ttc", family: "Menlo", monospace: true},
		{path: "/System/Library/Fonts/Geneva.ttf", family: "Geneva", monospace: false},
	}
	for _, tc := range cases {
		t.Run(tc.family, func(t *testing.T) {
			if _, err := os.Stat(tc.path); err != nil {
				t.Skipf("本机没有 %s", tc.path)
			}
			fonts, err := parseFontFile(tc.path)
			if err != nil {
				t.Fatalf("解析 %s 失败: %v", tc.path, err)
			}
			if len(fonts) == 0 {
				t.Fatalf("%s 没解析出字体", tc.path)
			}
			for _, font := range fonts {
				if font.Family != tc.family {
					t.Errorf("family = %q，期望 %q", font.Family, tc.family)
				}
				if font.Monospace != tc.monospace {
					t.Errorf("%s monospace = %v，期望 %v", font.Family, font.Monospace, tc.monospace)
				}
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	got := normalize([]SystemFont{
		{Family: "menlo"},
		{Family: ".SF NS"},
		{Family: "Menlo", Monospace: true},
		{Family: "  "},
		{Family: "Arial"},
	})
	if len(got) != 2 {
		t.Fatalf("len = %d，期望 2：%v", len(got), got)
	}
	if got[0].Family != "Arial" || got[1].Family != "menlo" || !got[1].Monospace {
		t.Fatalf("结果不对：%v", got)
	}
}
