// Package sysfonts 列出本机已安装的字体家族，供设置页「自定义字体」挑选。
//
// macOS 走 CoreText；Windows / Linux 扫描字体目录并用 sfnt 解析 family 名。
package sysfonts

import (
	"sort"
	"strings"
	"sync"
)

// SystemFont 一个字体家族。
type SystemFont struct {
	Family    string `json:"family"`
	Monospace bool   `json:"monospace"`
}

var (
	cacheOnce  sync.Once
	cacheFonts []SystemFont
	cacheErr   error
)

// List 返回本机字体家族：按 Family 去重（不区分大小写）、不区分大小写排序。
// 进程内只读取一次，之后复用结果。
func List() ([]SystemFont, error) {
	cacheOnce.Do(func() {
		fonts, err := listPlatform()
		if err != nil {
			cacheErr = err
			return
		}
		cacheFonts = normalize(fonts)
	})
	return cacheFonts, cacheErr
}

// normalize 去掉空名和隐藏字体，同名家族合并（任一字体文件是等宽就算等宽），再排序。
func normalize(fonts []SystemFont) []SystemFont {
	byKey := make(map[string]int, len(fonts))
	result := make([]SystemFont, 0, len(fonts))
	for _, font := range fonts {
		family := strings.TrimSpace(font.Family)
		if family == "" || strings.HasPrefix(family, ".") {
			continue
		}
		key := strings.ToLower(family)
		index, exists := byKey[key]
		if exists {
			if font.Monospace {
				result[index].Monospace = true
			}
			continue
		}
		byKey[key] = len(result)
		result = append(result, SystemFont{Family: family, Monospace: font.Monospace})
	}
	sort.Slice(result, func(i, j int) bool {
		return strings.ToLower(result[i].Family) < strings.ToLower(result[j].Family)
	})
	return result
}
