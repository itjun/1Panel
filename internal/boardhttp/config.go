package boardhttp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	DefaultPort    = 8888
	configFileName = "board_http.json"
)

// Config 看板 HTTP 网关开关与端口。
type Config struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port"`
}

// DefaultConfig 默认开启、端口 8888。
func DefaultConfig() Config {
	return Config{Enabled: true, Port: DefaultPort}
}

func configPath(appName string) (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, appName, configFileName), nil
}

// LoadConfig 读盘；缺失或损坏时回退默认。
func LoadConfig(appName string) Config {
	cfg := DefaultConfig()
	path, err := configPath(appName)
	if err != nil {
		return cfg
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return cfg
	}
	var raw Config
	if json.Unmarshal(b, &raw) != nil {
		return cfg
	}
	if raw.Port <= 0 || raw.Port > 65535 {
		raw.Port = DefaultPort
	}
	return raw
}

// SaveConfig 校验并落盘。
func SaveConfig(appName string, cfg Config) error {
	if cfg.Port <= 0 || cfg.Port > 65535 {
		return fmt.Errorf("端口无效: %d", cfg.Port)
	}
	path, err := configPath(appName)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0644)
}
