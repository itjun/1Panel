// Package regularfile opens regular files without following links or blocking on FIFOs.
package regularfile

import (
	"fmt"
	"os"
)

func Open(path string) (*os.File, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() {
		return nil, fmt.Errorf("不是普通文件：%s", path)
	}
	file, err := openFile(path)
	if err != nil {
		return nil, err
	}
	after, err := file.Stat()
	if err != nil || !after.Mode().IsRegular() || !os.SameFile(before, after) {
		file.Close()
		return nil, fmt.Errorf("文件在读取前发生变化：%s", path)
	}
	return file, nil
}
