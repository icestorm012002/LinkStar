package config

import (
	"os"
)

type Config struct {
	Port       string
	TempRoot   string
	ClaudePath string
	RedisAddr  string
	RedisPass  string
}

func LoadConfig() *Config {
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}
	tempRoot := os.Getenv("TEMP_ROOT")
	if tempRoot == "" {
		tempRoot = "/tmp/agent_env"
	}
	claudePath := os.Getenv("CLAUDE_PATH")
	if claudePath == "" {
		claudePath = "claude"
	}
	redisAddr := os.Getenv("REDIS_ADDR")
	// #12 修复：不再默认连接 localhost:6379
	// 未配置 REDIS_ADDR 时留空，系统将使用本地文件 fallback
	return &Config{
		Port:       port,
		TempRoot:   tempRoot,
		ClaudePath: claudePath,
		RedisAddr:  redisAddr,
		RedisPass:  os.Getenv("REDIS_PASS"),
	}
}
