//go:build !darwin

package sshd

import "net"

func TriggerLocalNetworkPrivacy() {}

func shouldRetryLAN(string, error) bool { return false }

func retryDialTCP(string) (net.Conn, error) {
	return nil, nil
}
