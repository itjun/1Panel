//go:build darwin

package localsys

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"
)

func readDiskModel(device string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/sbin/diskutil", "info", "-plist", device).Output()
	if ctx.Err() != nil {
		return "", fmt.Errorf("读取硬盘型号超时：%w", ctx.Err())
	}
	if err != nil {
		return "", fmt.Errorf("读取硬盘型号失败：%w", err)
	}
	return parseDiskMediaName(out)
}

func parseDiskMediaName(raw []byte) (string, error) {
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	key := ""
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return "", nil
		}
		if err != nil {
			return "", fmt.Errorf("解析硬盘型号失败：%w", err)
		}
		start, isStart := token.(xml.StartElement)
		if !isStart {
			continue
		}
		switch start.Name.Local {
		case "key":
			if err := decoder.DecodeElement(&key, &start); err != nil {
				return "", err
			}
		case "string":
			if key == "MediaName" {
				var model string
				if err := decoder.DecodeElement(&model, &start); err != nil {
					return "", err
				}
				return strings.TrimSpace(model), nil
			}
		}
	}
}
