package appbackup

import "runtime"

func currentOS() string { return runtime.GOOS }
