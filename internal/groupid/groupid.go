// Package groupid contains the single validation rule shared by the Panel
// runtime model and the legacy group compatibility store.
package groupid

import (
	"fmt"
	"strings"
)

// Validate requires a group ID to be the same user-facing name, made of ASCII
// letters, numbers and single hyphen separators only, for example "cdcp-main"
// or "01-cdcp-main". A numeric prefix is optional (only used for sorting); the
// value stays safe and predictable as a filename.
func Validate(value string) error {
	value = strings.TrimSpace(value)
	previousHyphen := false
	hasWord := false
	for i := 0; i < len(value); i++ {
		ch := value[i]
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
	return fmt.Errorf("分组名称只能使用英文字母、数字和短横线，例如 cdcp-main 或 01-cdcp-main")
}

func isASCIILetter(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

func isASCIIDigit(ch byte) bool {
	return ch >= '0' && ch <= '9'
}
