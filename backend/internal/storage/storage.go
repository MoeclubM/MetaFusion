package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/transcoder"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"gorm.io/gorm"
)

type StorageService struct {
	client      *minio.Client
	coreClient  *minio.Core
	cfg         *config.Config
	db          *gorm.DB
	asynqClient *asynq.Client
}

func NewStorageService(cfg *config.Config, db *gorm.DB, asynqClient *asynq.Client) (*StorageService, error) {
	endpoint := cfg.S3Endpoint
	// 去除可能携带的 http:// 前缀
	endpoint = strings.TrimPrefix(endpoint, "http://")
	endpoint = strings.TrimPrefix(endpoint, "https://")

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, err
	}

	coreClient, err := minio.NewCore(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, err
	}

	return &StorageService{
		client:      client,
		coreClient:  coreClient,
		cfg:         cfg,
		db:          db,
		asynqClient: asynqClient,
	}, nil
}

type InitiateUploadRequest struct {
	ReleaseID        *uuid.UUID `json:"release_id"`         // 可选：兼容老版本或指定 Release
	MediumID         *uuid.UUID `json:"medium_id"`          // 可选：指定 Medium 载体
	TrackID          *uuid.UUID `json:"track_id"`           // 可选：指定 Track 曲目
	CanonicalEntryID *uuid.UUID `json:"canonical_entry_id"` // 可选：指定母版录音
	TargetEntityType string     `json:"target_entity_type"` // 'medium', 'track', 'canonical_entry', 'release', 'work'
	TargetEntityID   *uuid.UUID `json:"target_entity_id"`   // 挂载目标实体的 UUID
	BindingRole      string     `json:"binding_role"`       // 'master_archive', 'disc_image', 'track_audio', 'scans', 'video'
	FileRole         string     `json:"file_role"`          // master_archive / preview_sample / artwork
	FileName         string     `json:"file_name" binding:"required"`
	FileSize         int64      `json:"file_size" binding:"required"`
	Sha256Hash       string     `json:"sha256_hash" binding:"required"`
	MimeType         string     `json:"mime_type" binding:"required"`
	PartCount        int        `json:"part_count" binding:"required,min=1"`
}

type InitiateUploadResponse struct {
	IsInstantUpload bool      `json:"is_instant_upload"`
	AssetID         uuid.UUID `json:"asset_id"`
	UploadID        string    `json:"upload_id,omitempty"`
	S3Key           string    `json:"s3_key,omitempty"`
	PresignedURLs   []string  `json:"presigned_urls,omitempty"`
}

// InitiateUpload 初始化大文件上传 (支持独立 CAS 资产库与多态实体挂载，优先检查秒传)
func (s *StorageService) InitiateUpload(ctx context.Context, req *InitiateUploadRequest) (*InitiateUploadResponse, error) {
	if req.PartCount <= 0 || req.PartCount > 10000 {
		return nil, fmt.Errorf("invalid part count: must be between 1 and 10000")
	}

	fileRole := req.FileRole
	if fileRole == "" {
		fileRole = "master_archive"
	}
	bindingRole := req.BindingRole
	if bindingRole == "" {
		bindingRole = fileRole
	}

	// 确定有效挂载目标
	var targetType string
	var targetID *uuid.UUID

	if req.TargetEntityType != "" && req.TargetEntityID != nil && *req.TargetEntityID != uuid.Nil {
		targetType = req.TargetEntityType
		targetID = req.TargetEntityID
	} else if req.TrackID != nil && *req.TrackID != uuid.Nil {
		targetType = "track"
		targetID = req.TrackID
	} else if req.MediumID != nil && *req.MediumID != uuid.Nil {
		targetType = "medium"
		targetID = req.MediumID
	} else if req.CanonicalEntryID != nil && *req.CanonicalEntryID != uuid.Nil {
		targetType = "canonical_entry"
		targetID = req.CanonicalEntryID
	} else if req.ReleaseID != nil && *req.ReleaseID != uuid.Nil {
		targetType = "release"
		targetID = req.ReleaseID
	}
	targetType = strings.ToLower(strings.TrimSpace(targetType))
	if len(bindingRole) > 64 {
		return nil, fmt.Errorf("binding_role exceeds 64 characters")
	}
	if targetType != "" && targetID != nil {
		if err := validateBindingTarget(s.db, targetType, *targetID); err != nil {
			return nil, err
		}
	}

	// 1. 检查秒传 (Instant Upload / CAS Deduplication)
	var existingRegistry models.AssetRegistry
	errReg := s.db.Where("sha256_hash = ? AND transcode_status = 'completed'", req.Sha256Hash).First(&existingRegistry).Error
	if errReg == nil {
		// 命中秒传：若提供了挂载目标，在 asset_bindings 中登记关联。
		if targetType != "" && targetID != nil {
			if _, err := bindAssetDB(s.db, &BindAssetRequest{
				AssetID:          existingRegistry.ID,
				TargetEntityType: targetType,
				TargetEntityID:   *targetID,
				BindingRole:      bindingRole,
			}); err != nil {
				return nil, err
			}
		}

		return &InitiateUploadResponse{
			IsInstantUpload: true,
			AssetID:         existingRegistry.ID,
		}, nil
	}

	// 2. 未命中秒传：安全过滤文件名并生成 S3 Key
	cleanFileName := filepath.Base(filepath.Clean(strings.TrimSpace(req.FileName)))
	if cleanFileName == "." || cleanFileName == "/" || cleanFileName == "\\" || cleanFileName == "" {
		cleanFileName = "file.bin"
	}
	now := time.Now()
	s3Key := fmt.Sprintf("masters/%d/%02d/%s/%s", now.Year(), now.Month(), uuid.New().String(), cleanFileName)

	uploadID, err := s.coreClient.NewMultipartUpload(ctx, s.cfg.S3BucketMaster, s3Key, minio.PutObjectOptions{
		ContentType: req.MimeType,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initiate multipart upload: %w", err)
	}

	// 3. 生成每个分片的预签名上传 URL
	presignedURLs := make([]string, req.PartCount)
	for i := 1; i <= req.PartCount; i++ {
		urlValues := make(url.Values)
		urlValues.Set("uploadId", uploadID)
		urlValues.Set("partNumber", fmt.Sprintf("%d", i))

		partURL, err := s.client.Presign(ctx, "PUT", s.cfg.S3BucketMaster, s3Key, 6*time.Hour, urlValues)
		if err != nil {
			return nil, fmt.Errorf("failed to presign part %d: %w", i, err)
		}
		presignedURLs[i-1] = s.formatPublicURL(partURL.String())
	}

	// 4. 原子登记 CAS 资产与挂载关系。新上传不再制造 AssetFile 兼容行。
	registryItem := models.AssetRegistry{
		Sha256Hash:      req.Sha256Hash,
		FileName:        req.FileName,
		FileSize:        req.FileSize,
		MimeType:        req.MimeType,
		S3Bucket:        s.cfg.S3BucketMaster,
		S3Key:           s3Key,
		StorageTier:     "hot_s3",
		TranscodeStatus: "pending",
	}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&registryItem).Error; err != nil {
			return err
		}
		if targetType != "" && targetID != nil {
			_, err := bindAssetDB(tx, &BindAssetRequest{
				AssetID:          registryItem.ID,
				TargetEntityType: targetType,
				TargetEntityID:   *targetID,
				BindingRole:      bindingRole,
			})
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}

	return &InitiateUploadResponse{
		IsInstantUpload: false,
		AssetID:         registryItem.ID,
		UploadID:        uploadID,
		S3Key:           s3Key,
		PresignedURLs:   presignedURLs,
	}, nil
}

type CompleteUploadRequest struct {
	AssetID  uuid.UUID          `json:"asset_id" binding:"required"`
	UploadID string             `json:"upload_id" binding:"required"`
	S3Key    string             `json:"s3_key" binding:"required"`
	Parts    []minio.CompletePart `json:"parts" binding:"required"`
}

// CompleteUpload 完成分片合并并触发异步转码质检
func (s *StorageService) CompleteUpload(ctx context.Context, req *CompleteUploadRequest) error {
	_, err := s.coreClient.CompleteMultipartUpload(ctx, s.cfg.S3BucketMaster, req.S3Key, req.UploadID, req.Parts, minio.PutObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to complete multipart upload: %w", err)
	}

	// 投递 Asynq 异步转码质检任务
	task, err := transcoder.NewTranscodeTask(req.AssetID)
	if err != nil {
		return err
	}
	_, err = s.asynqClient.Enqueue(task, asynq.Queue("transcode"), asynq.MaxRetry(3))
	return err
}

// GetDownloadURL 生成原档下载链接。AssetRegistry 是 CAS 事实源，AssetFile 仅兼容旧数据。
func (s *StorageService) GetDownloadURL(ctx context.Context, assetID uuid.UUID) (string, error) {
	var fileName, bucket, key string
	var registry models.AssetRegistry
	if err := s.db.First(&registry, assetID).Error; err == nil {
		fileName = registry.FileName
		bucket = registry.S3Bucket
		key = registry.S3Key
	} else {
		var legacy models.AssetFile
		if legacyErr := s.db.First(&legacy, assetID).Error; legacyErr != nil {
			return "", legacyErr
		}
		fileName = legacy.FileName
		bucket = legacy.S3Bucket
		key = legacy.S3Key
	}

	reqParams := make(url.Values)
	reqParams.Set("response-content-disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))

	u, err := s.client.PresignedGetObject(ctx, bucket, key, 2*time.Hour, reqParams)
	if err != nil {
		return "", err
	}
	return s.formatPublicURL(u.String()), nil
}

func (s *StorageService) formatPublicURL(rawURL string) string {
	if s.cfg.S3PublicURL == "" {
		return rawURL
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	publicParsed, err := url.Parse(s.cfg.S3PublicURL)
	if err != nil {
		return rawURL
	}
	parsed.Scheme = publicParsed.Scheme
	parsed.Host = publicParsed.Host
	return parsed.String()
}

// UploadAvatar 将头像上传至 S3 预览桶 (metafusion-preview) 或本地持久化存储
func (s *StorageService) UploadAvatar(ctx context.Context, file io.Reader, size int64, mimeType string, ext string) (string, error) {
	if ext == "" {
		ext = ".jpg"
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	fileName := fmt.Sprintf("%s%s", uuid.New().String(), ext)
	s3Key := fmt.Sprintf("avatars/%s", fileName)

	// 1. 如果 MinIO 客户端已就绪，优先上传到 S3 预览桶
	if s.client != nil && s.cfg.S3BucketPreview != "" {
		_, err := s.client.PutObject(ctx, s.cfg.S3BucketPreview, s3Key, file, size, minio.PutObjectOptions{
			ContentType: mimeType,
		})
		if err == nil {
			// 经由 Nginx /storage/preview/ 代理路由
			return fmt.Sprintf("/storage/preview/%s", s3Key), nil
		}
	}

	// 2. 本地回退存储 (支持离线开发与本地调试)
	uploadDir := filepath.Join(".", "uploads", "avatars")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create upload directory: %w", err)
	}
	destPath := filepath.Join(uploadDir, fileName)
	destFile, err := os.Create(destPath)
	if err != nil {
		return "", fmt.Errorf("failed to create local file: %w", err)
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, file); err != nil {
		return "", fmt.Errorf("failed to write local file: %w", err)
	}

	return fmt.Sprintf("/uploads/avatars/%s", fileName), nil
}

// UploadCover 将作品/发行版封面上传至 S3 预览桶 (metafusion-preview) 或本地持久化存储
func (s *StorageService) UploadCover(ctx context.Context, file io.Reader, size int64, mimeType string, ext string) (string, error) {
	if ext == "" {
		ext = ".jpg"
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	fileName := fmt.Sprintf("%s%s", uuid.New().String(), ext)
	s3Key := fmt.Sprintf("covers/%s", fileName)

	// 1. 如果 MinIO 客户端已就绪，优先上传到 S3 预览桶
	if s.client != nil && s.cfg.S3BucketPreview != "" {
		_, err := s.client.PutObject(ctx, s.cfg.S3BucketPreview, s3Key, file, size, minio.PutObjectOptions{
			ContentType: mimeType,
		})
		if err == nil {
			// 经由 Nginx /storage/preview/ 代理路由或 S3 公网访问
			return fmt.Sprintf("/storage/preview/%s", s3Key), nil
		}
	}

	// 2. 本地回退存储 (支持离线开发与本地调试)
	uploadDir := filepath.Join(".", "uploads", "covers")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create upload directory: %w", err)
	}
	destPath := filepath.Join(uploadDir, fileName)
	destFile, err := os.Create(destPath)
	if err != nil {
		return "", fmt.Errorf("failed to create local file: %w", err)
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, file); err != nil {
		return "", fmt.Errorf("failed to write local file: %w", err)
	}

	return fmt.Sprintf("/uploads/covers/%s", fileName), nil
}

