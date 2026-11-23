package sshconfig

import (
	"crypto/hmac"
	"crypto/sha1" // OpenSSH's version 1 hostname hash uses HMAC-SHA1.
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

var knownHostsMu sync.Mutex

type knownHostsEdit struct {
	path         string
	before, next string
	existed      bool
}

// WithKnownHostKey updates the user's OpenSSH records for one endpoint. A nil key
// removes the records. If saving the host configuration fails, restore the keys.
func WithKnownHostKey(host, port, keyAlias string, key ssh.PublicKey, saveConfig func() error) error {
	_, err := withKnownHostKey(host, port, keyAlias, key, false, saveConfig)
	return err
}

// WithCheckedHostKey repairs a missing or changed key and preserves matching records.
func WithCheckedHostKey(host, port, keyAlias string, key ssh.PublicKey, saveConfig func() error) (bool, error) {
	return withKnownHostKey(host, port, keyAlias, key, true, saveConfig)
}

var knownHostsFiles = [...]string{"known_hosts", "known_hosts2"}

func hostKeyIdentities(host, port, keyAlias string) (string, []string, error) {
	if port == "" {
		port = "22"
	}
	host = strings.TrimSuffix(strings.TrimPrefix(strings.ToLower(host), "["), "]")
	address := knownhosts.Normalize(net.JoinHostPort(host, port))
	identities := []string{address}
	if port == "22" {
		identities = append(identities, net.JoinHostPort(host, port))
	}
	if keyAlias != "" {
		address, identities = keyAlias, []string{keyAlias}
	}
	if host == "" || strings.ContainsAny(address, " \t\r\n,*?!|#@") {
		return "", nil, fmt.Errorf("SSH 主机地址无效: %q", address)
	}
	return address, identities, nil
}

func withKnownHostKey(host, port, keyAlias string, key ssh.PublicKey, keepMatching bool, saveConfig func() error) (bool, error) {
	config, err := ConfigPath()
	if err != nil {
		return false, err
	}
	address, identities, err := hostKeyIdentities(host, port, keyAlias)
	if err != nil {
		return false, err
	}

	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	var edits []knownHostsEdit
	for _, file := range knownHostsFiles {
		path := filepath.Join(filepath.Dir(config), file)
		info, err := os.Lstat(path)
		existed := err == nil
		if err != nil && !os.IsNotExist(err) {
			return false, err
		}
		var before []byte
		if existed {
			if info.Mode()&os.ModeSymlink != 0 {
				path, err = filepath.EvalSymlinks(path)
				if err != nil {
					return false, err
				}
				info, err = os.Stat(path)
				if err != nil {
					return false, err
				}
			}
			if !info.Mode().IsRegular() {
				return false, fmt.Errorf("%s 不是普通文件", path)
			}
			before, err = os.ReadFile(path)
			if err != nil {
				return false, err
			}
		}
		if keepMatching && hasKnownHostKey(string(before), identities, key) {
			return false, saveConfig()
		}
		next, hashed := removeKnownHostEntries(string(before), identities)
		if key != nil && file == "known_hosts" {
			entry := address
			if hashed {
				entry = knownhosts.HashHostname(address)
			}
			if next != "" && !strings.HasSuffix(next, "\n") {
				next += "\n"
			}
			next += entry + " " + string(ssh.MarshalAuthorizedKey(key))
		}
		if next != string(before) {
			edits = append(edits, knownHostsEdit{path: path, before: string(before), next: next, existed: existed})
		}
	}

	written := 0
	for _, edit := range edits {
		if err = checkKnownHostsContent(edit.path, edit.before, edit.existed); err == nil {
			err = writeConfigAtomic(edit.path, edit.next)
		}
		if err != nil {
			break
		}
		written++
	}
	if err == nil {
		err = saveConfig()
	}
	if err == nil {
		return len(edits) > 0, nil
	}
	if written < len(edits) {
		err = fmt.Errorf("更新本机 SSH 主机指纹失败: %w", err)
	}
	for _, edit := range edits[:written] {
		rollbackErr := checkKnownHostsContent(edit.path, edit.next, true)
		if rollbackErr == nil {
			if edit.existed {
				rollbackErr = writeConfigAtomic(edit.path, edit.before)
			} else {
				rollbackErr = os.Remove(edit.path)
			}
		}
		if rollbackErr != nil {
			err = errors.Join(err, fmt.Errorf("恢复 %s 失败: %w", edit.path, rollbackErr))
		}
	}
	return false, err
}

func hasKnownHostKey(content string, identities []string, key ssh.PublicKey) bool {
	encoding := base64.StdEncoding.EncodeToString(key.Marshal())
	for entry := range matchingKnownHostKeys(content, identities) {
		if entry[0] == key.Type() && entry[1] == encoding {
			return true
		}
	}
	return false
}

// KnownHostAlgorithms prefers the key types already trusted for this endpoint,
// so a server offering several keys does not trigger a spurious replacement.
func KnownHostAlgorithms(host, port, keyAlias string) (string, error) {
	config, err := ConfigPath()
	if err != nil {
		return "", err
	}
	_, identities, err := hostKeyIdentities(host, port, keyAlias)
	if err != nil {
		return "", err
	}
	types := make(map[string]bool)
	for _, file := range knownHostsFiles {
		path := filepath.Join(filepath.Dir(config), file)
		info, err := os.Stat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("%s 不是普通文件", path)
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		for entry := range matchingKnownHostKeys(string(content), identities) {
			types[entry[0]] = true
		}
	}
	var preferred, remaining []string
	for _, algorithm := range ssh.SupportedAlgorithms().HostKeys {
		keyType := algorithm
		switch algorithm {
		case ssh.KeyAlgoRSASHA256, ssh.KeyAlgoRSASHA512:
			keyType = ssh.KeyAlgoRSA
		case ssh.CertAlgoRSASHA256v01, ssh.CertAlgoRSASHA512v01:
			keyType = ssh.CertAlgoRSAv01
		}
		if types[keyType] {
			preferred = append(preferred, algorithm)
		} else {
			remaining = append(remaining, algorithm)
		}
	}
	if len(preferred) == 0 {
		return "", nil
	}
	return strings.Join(append(preferred, remaining...), ","), nil
}

func matchingKnownHostKeys(content string, identities []string) func(func([2]string) bool) {
	return func(yield func([2]string) bool) {
		for line := range strings.SplitSeq(content, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 3 || strings.HasPrefix(fields[0], "@") || strings.HasPrefix(fields[0], "#") {
				continue
			}
			for host := range strings.SplitSeq(fields[0], ",") {
				if matchesKnownHost(host, identities) {
					if !yield([2]string{fields[1], fields[2]}) {
						return
					}
					break
				}
			}
		}
	}
}

func checkKnownHostsContent(path, expected string, existed bool) error {
	current, err := os.ReadFile(path)
	if !existed && os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !existed || string(current) != expected {
		return fmt.Errorf("%s 已被外部修改", path)
	}
	return nil
}

// Remove only matching host tokens. Compound rows may also trust other hosts.
// Certificate authorities, revocations and wildcard policies are left intact.
func removeKnownHostEntries(content string, identities []string) (string, bool) {
	var result strings.Builder
	hashed := false
	for line := range strings.SplitAfterSeq(content, "\n") {
		trimmed := strings.TrimLeft(line, " \t")
		end := strings.IndexAny(trimmed, " \t")
		if end < 0 || strings.HasPrefix(trimmed, "@") || strings.HasPrefix(trimmed, "#") {
			result.WriteString(line)
			continue
		}
		hosts := trimmed[:end]
		var remaining []string
		for entry := range strings.SplitSeq(hosts, ",") {
			if matchesKnownHost(entry, identities) {
				hashed = hashed || strings.HasPrefix(entry, "|1|")
			} else {
				remaining = append(remaining, entry)
			}
		}
		if len(remaining) > 0 {
			result.WriteString(line[:len(line)-len(trimmed)] + strings.Join(remaining, ",") + trimmed[end:])
		}
	}
	return result.String(), hashed
}

func matchesKnownHost(entry string, identities []string) bool {
	if raw, ok := strings.CutPrefix(entry, "|1|"); ok {
		saltText, hashText, _ := strings.Cut(raw, "|")
		salt, saltErr := base64.StdEncoding.DecodeString(saltText)
		digest, hashErr := base64.StdEncoding.DecodeString(hashText)
		if saltErr != nil || hashErr != nil || len(salt) != sha1.Size || len(digest) != sha1.Size {
			return false
		}
		for _, target := range identities {
			mac := hmac.New(sha1.New, salt)
			_, _ = mac.Write([]byte(target))
			if hmac.Equal(mac.Sum(nil), digest) {
				return true
			}
		}
		return false
	}
	for _, target := range identities {
		if strings.EqualFold(entry, target) {
			return true
		}
	}
	return false
}
