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
	// DBSSLMode 与 cmd/server 同一环境变量（DB_SSLMODE，见 deploy/docker-compose.yml）：
	// 迁移此前把 sslmode=disable 写死在自己的内联串里，于是 DB_SSLMODE=require 的实例
	// 只有服务连接加密、迁移连接不加密——同一条 DSN 规则两份实现就会这样漂移。
	DBSSLMode string
}

func Load() *Config {
	return &Config{
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBUser:     getEnv("DB_USER", "metafusion"),
		DBPassword: os.Getenv("DB_PASSWORD"),
		DBName:     getEnv("DB_NAME", "metafusion_db"),
		DBSSLMode:  getEnv("DB_SSLMODE", "disable"),
	}
}

// DSN 是迁移工具**唯一**一份连接串构造（cmd/migrate 调它，不再内联第二份）。
// 参数集与 cmd/migrate 原来的内联串逐字一致（含 connect_timeout=10）；
// 唯一新增的是 DB_SSLMODE，不设时仍是 sslmode=disable，行为与改动前相同。
func (c *Config) DSN() string {
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s connect_timeout=10",
		c.DBHost, c.DBPort, c.DBUser, c.DBPassword, c.DBName, c.DBSSLMode)
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}
