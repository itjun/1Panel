package filetext

import (
	"bytes"
	"fmt"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// Preview 文本文件预览结果（展示用 Content 恒为 UTF-8）
type Preview struct {
	Path        string `json:"path"`
	Name        string `json:"name"`
	Content     string `json:"content"`     // UTF-8 文本（已去掉 BOM 以便编辑/展示）
	Encoding    string `json:"encoding"`    // 检测标签：UTF-8 / UTF-8 BOM / GBK / GB18030 / UTF-16LE …
	LineEnding  string `json:"lineEnding"`  // LF / CRLF / CR / Mixed / —
	NeedsNormalize bool `json:"needsNormalize"` // 非 Linux 标准（非纯 UTF-8 无 BOM + LF）
	Size        int    `json:"size"`        // 原始字节数
}

// DetectLineEnding 根据原始字节判断换行风格
func DetectLineEnding(raw []byte) string {
	if len(raw) == 0 {
		return "—"
	}
	crlf, cr, lf := 0, 0, 0
	for i := 0; i < len(raw); i++ {
		switch raw[i] {
		case '\r':
			if i+1 < len(raw) && raw[i+1] == '\n' {
				crlf++
				i++
			} else {
				cr++
			}
		case '\n':
			lf++
		}
	}
	kinds := 0
	label := "—"
	if crlf > 0 {
		kinds++
		label = "CRLF"
	}
	if lf > 0 {
		kinds++
		label = "LF"
	}
	if cr > 0 {
		kinds++
		label = "CR"
	}
	if kinds == 0 {
		return "—"
	}
	if kinds > 1 {
		return "Mixed"
	}
	return label
}

// DecodeToUTF8 识别编码并解码为 UTF-8 字符串（去掉 BOM）
func DecodeToUTF8(raw []byte) (text string, encLabel string, err error) {
	if len(raw) == 0 {
		return "", "UTF-8", nil
	}

	// BOM 优先
	if bytes.HasPrefix(raw, []byte{0xEF, 0xBB, 0xBF}) {
		s, e := decodeWith(unicode.UTF8, raw[3:])
		return s, "UTF-8 BOM", e
	}
	if bytes.HasPrefix(raw, []byte{0xFF, 0xFE}) {
		// UTF-16 LE
		s, e := decodeWith(unicode.UTF16(unicode.LittleEndian, unicode.ExpectBOM), raw)
		return s, "UTF-16LE", e
	}
	if bytes.HasPrefix(raw, []byte{0xFE, 0xFF}) {
		s, e := decodeWith(unicode.UTF16(unicode.BigEndian, unicode.ExpectBOM), raw)
		return s, "UTF-16BE", e
	}

	if utf8.Valid(raw) {
		return string(raw), "UTF-8", nil
	}

	// 常见中文 Windows 编码：GB18030 兼容 GBK
	if s, e := decodeWith(simplifiedchinese.GB18030, raw); e == nil && !hasManyReplacement(s) {
		return s, "GB18030", nil
	}
	if s, e := decodeWith(simplifiedchinese.GBK, raw); e == nil && !hasManyReplacement(s) {
		return s, "GBK", nil
	}

	// 兜底：按 UTF-8 替换非法序列
	return string(bytes.ToValidUTF8(raw, []byte("\uFFFD"))), "Unknown", nil
}

func decodeWith(enc encoding.Encoding, raw []byte) (string, error) {
	r := transform.NewReader(bytes.NewReader(raw), enc.NewDecoder())
	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(r); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func hasManyReplacement(s string) bool {
	// 解码失败时替换符过多则不可信
	n := 0
	for _, r := range s {
		if r == '\uFFFD' {
			n++
			if n > 8 {
				return true
			}
		}
	}
	return false
}

// NormalizeLinux 将文本规范为 UTF-8（无 BOM）+ LF 换行
func NormalizeLinux(text string) string {
	// 统一换行
	b := make([]byte, 0, len(text))
	runes := []rune(text)
	// 去掉 UTF-8 BOM 字符
	if len(runes) > 0 && runes[0] == '\ufeff' {
		runes = runes[1:]
	}
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if r == '\r' {
			if i+1 < len(runes) && runes[i+1] == '\n' {
				i++
			}
			b = append(b, '\n')
			continue
		}
		// 直接写 UTF-8
		var tmp [utf8.UTFMax]byte
		n := utf8.EncodeRune(tmp[:], r)
		b = append(b, tmp[:n]...)
	}
	return string(b)
}

// NeedsNormalize 是否需要转成 Linux 标准（UTF-8 无 BOM + LF）
func NeedsNormalize(enc, lineEnding string) bool {
	if enc != "UTF-8" {
		return true
	}
	if lineEnding != "LF" && lineEnding != "—" {
		// 空文件 lineEnding 为 — 视为 OK
		return true
	}
	return false
}

// BuildPreview 从原始字节构建预览
func BuildPreview(path, name string, raw []byte) (Preview, error) {
	text, enc, err := DecodeToUTF8(raw)
	if err != nil {
		return Preview{}, fmt.Errorf("解码失败: %w", err)
	}
	le := DetectLineEnding(raw)
	return Preview{
		Path:           path,
		Name:           name,
		Content:        text,
		Encoding:       enc,
		LineEnding:     le,
		NeedsNormalize: NeedsNormalize(enc, le),
		Size:           len(raw),
	}, nil
}

// IsLikelyText 粗判是否为文本文件：字节序列不含 NUL 视为文本。
// 二进制文件几乎都含 NUL（如图片/压缩包/可执行），文本文件极少含。
func IsLikelyText(raw []byte) bool {
	for _, b := range raw {
		if b == 0 {
			return false
		}
	}
	return true
}
