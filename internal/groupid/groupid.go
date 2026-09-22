// Package groupid contains the single validation rule shared by the Panel
// runtime model and the legacy group compatibility store.
package groupid

import (
	"fmt"
	"strings"
)

// Validate requires a group ID to be the same user-facing name and to start
// with exactly two ASCII digits followed by a hyphen, for example
// "01-cdcp-main". The remainder is made of ASCII letters, numbers and single
// hyphen separators only, so the value is safe and predictable as a filename.
func Validate(value string) error {
	value = strings.TrimSpace(value)
	if len(value) < 4 || value[2] != '-' || value[0] < '0' || value[0] > '9' || value[1] < '0' || value[1] > '9' {
		return invalidFormatError()
	}
	suffix := value[3:]
	previousHyphen := false
	hasWord := false
	for i := 0; i < len(suffix); i++ {
		ch := suffix[i]
		switch {
		case isASCIILetter(ch) || isASCIIDigit(ch):
			hasWord = true
			previousHyphen = false
		case ch == '-' && hasWord && !previousHyphen:
			previousHyphen = true
		default:
			return invalidFormatError()
		}
	}
	if !hasWord || previousHyphen {
		return invalidFormatError()
	}
	return nil
}

func invalidFormatError() error {
	return fmt.Errorf("分组名称只能使用两位数字前缀、英文字母、数字和短横线，例如 01-cdcp-main")
}

func isASCIILetter(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

func isASCIIDigit(ch byte) bool {
	return ch >= '0' && ch <= '9'
}
