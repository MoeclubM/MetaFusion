// Package config 只服务 cmd/migrate（版本化数据库迁移工具）。
//
// 运行中的服务不读这里：cmd/server 直接读环境变量，存储等配置随子系统拆分迁到了
// 对应服务（storage 服务读 STORAGE_S3_*，对象存储是 RustFS）。因此这里只保留
// 迁移真正需要的数据库连接信息，避免留下"文档里写着、代码里没人读"的死配置。
package config

import (
	"fmt"
	"os"
)

type Config struct {
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
}

func Load() *Config {
	return &Config{
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBUser:     getEnv("DB_USER", "metafusion"),
		DBPassword: os.Getenv("DB_PASSWORD"),
		DBName:     getEnv("DB_NAME", "metafusion_db"),
	}
}

func (c *Config) DSN() string {
	return fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC",
		c.DBHost, c.DBUser, c.DBPassword, c.DBName, c.DBPort)
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}
