//go:build !darwin

package app

func appIcon(icon []byte) []byte { return icon }
