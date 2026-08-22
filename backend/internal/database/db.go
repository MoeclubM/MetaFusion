package database

import (
	"log"
	"time"

	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func InitDB(cfg *config.Config) (*gorm.DB, error) {
	var db *gorm.DB
	var err error

	// 针对容器启动时数据库尚未就绪的情况，进行重试连接
	for i := 0; i < 10; i++ {
		db, err = gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Warn),
		})
		if err == nil {
			break
		}
		log.Printf("Connecting to database... attempt %d/10: %v", i+1, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	// 连接池调优 (针对高并发与大文件元数据读写)
	sqlDB.SetMaxIdleConns(25)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	// 自动同步模型结构（若数据库已有表则跳过，不影响手动执行的 01_schema.sql）
	_ = db.AutoMigrate(
		&models.User{},
		&models.Invitation{},
		&models.Category{},
		&models.VirtualShelf{},
		&models.Tag{},
		&models.Artist{},
		&models.WorkArtistRelation{},
		&models.Work{},
		&models.Release{},
		&models.Medium{},
		&models.CanonicalEntry{},
		&models.Track{},
		&models.AssetFile{},
			&models.EntityRelationship{},
			&models.RelationType{},
			&models.EntityTypeDefinition{},
			&models.ForumBoard{},
		&models.UserGroup{},
		&models.DiscussionTopic{},
		&models.ForumPost{},
		&models.WorkTranslation{},
		&models.TopicTranslation{},
		&models.TagTranslation{},
		&models.ArtistTranslation{},
		&models.Comment{},
		&models.AdminAuditLog{},
		&models.SystemSetting{},
		&models.UserCustomShelf{},
		&models.UserHomeLayout{},
		&models.DirectMessage{},
		&models.EntityRevision{},
		&models.ApiToken{},
		&models.Favorite{},
	)
	log.Println("Database connection pool initialized successfully.")
	return db, nil
}
