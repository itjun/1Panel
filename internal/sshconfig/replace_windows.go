//go:build windows

package sshconfig

import "os"

func replaceFile(oldpath, newpath string) error {
	// Windows os.Rename fails if dest exists. golang.org/x/sys/windows has
	// no ReplaceFile; Remove+Rename leaves a brief empty window.
	if err := os.Remove(newpath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(oldpath, newpath)
}
