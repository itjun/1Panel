package sysfonts

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"
)

// scanFontDirs 递归扫描目录里的 .ttf / .otf / .ttc / .otc；目录不存在或单个文件解析失败都跳过。
func scanFontDirs(dirs []string) []SystemFont {
	var fonts []SystemFont
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		_ = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if entry.IsDir() {
				return nil
			}
			parsed, parseErr := parseFontFile(path)
			if parseErr != nil {
				return nil
			}
			fonts = append(fonts, parsed...)
			return nil
		})
	}
	return fonts
}

// parseFontFile 解析单个字体文件，返回其中每个字体的家族名与是否等宽。
// 不认识的扩展名返回 nil, nil。
func parseFontFile(path string) ([]SystemFont, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".ttf" && ext != ".otf" && ext != ".ttc" && ext != ".otc" {
		return nil, nil
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	collection, err := sfnt.ParseCollectionReaderAt(file)
	if err != nil {
		return nil, err
	}

	var buf sfnt.Buffer
	var fonts []SystemFont
	for i := 0; i < collection.NumFonts(); i++ {
		face, err := collection.Font(i)
		if err != nil {
			continue
		}
		family := fontFamilyName(face, &buf)
		if family == "" {
			continue
		}
		fonts = append(fonts, SystemFont{Family: family, Monospace: isMonospace(face, &buf)})
	}
	return fonts, nil
}

// fontFamilyName 优先取 Typographic Family（ID 16），没有再取 Family（ID 1）。
func fontFamilyName(face *sfnt.Font, buf *sfnt.Buffer) string {
	name, err := face.Name(buf, sfnt.NameIDTypographicFamily)
	if err == nil && strings.TrimSpace(name) != "" {
		return strings.TrimSpace(name)
	}
	name, err = face.Name(buf, sfnt.NameIDFamily)
	if err == nil {
		return strings.TrimSpace(name)
	}
	return ""
}

// isMonospace 比较字形 'i' 与 'M' 的横向步进是否相等；任一字形缺失视为非等宽。
func isMonospace(face *sfnt.Font, buf *sfnt.Buffer) bool {
	ppem := fixed.I(int(face.UnitsPerEm()))
	narrow, err := face.GlyphIndex(buf, 'i')
	if err != nil || narrow == 0 {
		return false
	}
	wide, err := face.GlyphIndex(buf, 'M')
	if err != nil || wide == 0 {
		return false
	}
	narrowAdvance, err := face.GlyphAdvance(buf, narrow, ppem, font.HintingNone)
	if err != nil {
		return false
	}
	wideAdvance, err := face.GlyphAdvance(buf, wide, ppem, font.HintingNone)
	if err != nil {
		return false
	}
	return narrowAdvance == wideAdvance
}
