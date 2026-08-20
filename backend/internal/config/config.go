package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port         string
	DBHost       string
	DBPort       string
	DBUser       string
	DBPassword   string
	DBName       string
	RedisAddr    string
	ElasticURL   string
	S3Endpoint   string
	S3PublicURL  string
	S3AccessKey  string
	S3SecretKey  string
	S3BucketMaster string
	S3BucketPreview string
	JWTSecret    string
	MaxConcurrentVideo int
}

func Load() *Config {
	return &Config{
		Port:               getEnv("PORT", "8080"),
		DBHost:             getEnv("DB_HOST", "localhost"),
		DBPort:             getEnv("DB_PORT", "5432"),
		DBUser:             getEnv("DB_USER", "metafusion"),
		DBPassword:         getEnv("DB_PASSWORD", ""),
		DBName:             getEnv("DB_NAME", "metafusion_db"),
		RedisAddr:          getEnv("REDIS_ADDR", "localhost:6379"),
		ElasticURL:         getEnv("ELASTICSEARCH_URL", "http://localhost:9200"),
		S3Endpoint:         getEnv("S3_ENDPOINT", "localhost:9000"),
		S3PublicURL:        getEnv("S3_PUBLIC_ENDPOINT", "http://localhost:9000"),
		S3AccessKey:        getEnv("S3_ACCESS_KEY", ""),
		S3SecretKey:        getEnv("S3_SECRET_KEY", ""),
		S3BucketMaster:     getEnv("S3_BUCKET_MASTER", "metafusion-master"),
		S3BucketPreview:    getEnv("S3_BUCKET_PREVIEW", "metafusion-preview"),
		JWTSecret:          getEnv("JWT_SECRET", ""),
		MaxConcurrentVideo: getEnvInt("MAX_CONCURRENT_VIDEO_TASKS", 2),
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

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}
