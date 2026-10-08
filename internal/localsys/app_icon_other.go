//go:build !darwin || !cgo

package localsys

func appIconPNG(string, int) []byte { return nil }

func appDisplayName(string) string { return "" }
