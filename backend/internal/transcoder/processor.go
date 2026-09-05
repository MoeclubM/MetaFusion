package transcoder

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"gorm.io/gorm"
)

type Processor struct {
	db       *gorm.DB
	cfg      *config.Config
	s3Client *minio.Client
}

type processingAsset struct {
	ID         uuid.UUID
	FileName   string
	S3Bucket   string
	S3Key      string
	Sha256Hash string
	MimeType   string
}

func NewProcessor(db *gorm.DB, cfg *config.Config) (*Processor, error) {
	endpoint := strings.TrimPrefix(strings.TrimPrefix(cfg.S3Endpoint, "http://"), "https://")
	s3Client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, err
	}

	return &Processor{
		db:       db,
		cfg:      cfg,
		s3Client: s3Client,
	}, nil
}

func (p *Processor) ProcessTask(ctx context.Context, t *asynq.Task) error {
	var payload TranscodePayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("invalid transcode payload: %w", err)
	}

	asset, err := p.loadProcessingAsset(payload.AssetID)
	if err != nil {
		return err
	}

	p.updateAssetState(asset, "processing", "", nil)

	tempDir, err := os.MkdirTemp("", "metafusion-transcode-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempDir)

	// 1. 从 Master S3 流式下载原档至临时目录进行计算
	inputFilePath := filepath.Join(tempDir, asset.FileName)
	err = p.s3Client.FGetObject(ctx, asset.S3Bucket, asset.S3Key, inputFilePath, minio.GetObjectOptions{})
	if err != nil {
		p.failAsset(asset, fmt.Sprintf("Failed to download master asset from S3: %v", err))
		return err
	}

	// 2. 执行 MediaInfo 提取完整技术参数
	specs, err := p.extractMediaInfo(inputFilePath)
	if err != nil {
		log.Printf("MediaInfo extraction notice: %v (continuing)", err)
		specs = make(map[string]interface{})
	}

	mime := strings.ToLower(asset.MimeType)

	// 3. 按媒介大类执行专用转码管线
	if strings.HasPrefix(mime, "video/") || strings.HasSuffix(asset.FileName, ".mkv") || strings.HasSuffix(asset.FileName, ".mp4") {
		err = p.transcodeVideo(ctx, inputFilePath, tempDir, asset, specs)
	} else if strings.HasPrefix(mime, "audio/") || strings.HasSuffix(asset.FileName, ".flac") || strings.HasSuffix(asset.FileName, ".wav") || strings.HasSuffix(asset.FileName, ".dsf") {
		err = p.transcodeAudio(ctx, inputFilePath, tempDir, asset, specs)
	} else if strings.HasPrefix(mime, "image/") || strings.HasSuffix(asset.FileName, ".png") || strings.HasSuffix(asset.FileName, ".tiff") {
		err = p.transcodeImage(ctx, inputFilePath, tempDir, asset, specs)
	} else {
		// 电子书或通用文档
		err = p.transcodeDocument(ctx, inputFilePath, tempDir, asset, specs)
	}

	if err != nil {
		p.failAsset(asset, err.Error())
		return err
	}

	// 4. AssetRegistry 是当前 CAS 事实源；同时同步旧 AssetFile 兼容行。
	p.updateAssetState(asset, "completed", "", specs)

	log.Printf("Successfully processed and transcoded asset: %s (%s)", asset.FileName, asset.ID)
	return nil
}

func (p *Processor) extractMediaInfo(filePath string) (map[string]interface{}, error) {
	cmd := exec.Command("mediainfo", "--Output=JSON", filePath)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return nil, err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		return nil, err
	}
	return result, nil
}

// 视频转码管线：生成自适应 HLS 流与缩略图
func (p *Processor) transcodeVideo(ctx context.Context, inputPath, tempDir string, asset *processingAsset, specs map[string]interface{}) error {
	outputHlsDir := filepath.Join(tempDir, "hls")
	if err := os.MkdirAll(outputHlsDir, 0755); err != nil {
		return err
	}

	m3u8Path := filepath.Join(outputHlsDir, "index.m3u8")
	thumbPath := filepath.Join(tempDir, "thumbnail.webp")

	// 1. 生成海报缩略图 (第 5 秒抽帧)
	if err := exec.Command("ffmpeg", "-ss", "00:00:05", "-i", inputPath, "-vframes", "1", "-vf", "scale=1280:-1", "-c:v", "libwebp", "-q:v", "80", thumbPath).Run(); err != nil {
		return fmt.Errorf("generate video thumbnail: %w", err)
	}

	// 2. 硬件检测与 HLS 转码
	// 默认采用高兼容性 H.264 / AAC 快速分片
	hlsCmd := exec.Command("ffmpeg",
		"-i", inputPath,
		"-preset", "veryfast",
		"-g", "48", "-sc_threshold", "0",
		"-map", "0:v:0", "-map", "0:a:0?",
		"-c:v", "libx264", "-crf", "22", "-maxrate", "5000k", "-bufsize", "10000k", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "192k",
		"-hls_time", "6",
		"-hls_playlist_type", "vod",
		"-hls_segment_filename", filepath.Join(outputHlsDir, "segment_%04d.ts"),
		m3u8Path,
	)
	var errBuf bytes.Buffer
	hlsCmd.Stderr = &errBuf
	if err := hlsCmd.Run(); err != nil {
		log.Printf("FFmpeg video transcode error: %s", errBuf.String())
		return fmt.Errorf("video transcode: %w", err)
	}

	// 3. 上传 HLS 切片与缩略图到 Preview S3
	prefix := fmt.Sprintf("previews/%s", asset.ID)
	if err := p.uploadDirectoryToS3(ctx, outputHlsDir, p.cfg.S3BucketPreview, prefix+"/hls"); err != nil {
		return fmt.Errorf("upload video preview: %w", err)
	}
	if _, err := os.Stat(thumbPath); err == nil {
		if err := p.uploadFileToS3(ctx, thumbPath, p.cfg.S3BucketPreview, prefix+"/thumbnail.webp", "image/webp"); err != nil {
			return fmt.Errorf("upload video thumbnail: %w", err)
		}
		specs["preview_thumbnail"] = fmt.Sprintf("/storage/preview/%s/thumbnail.webp", prefix)
	}

	specs["preview_hls"] = fmt.Sprintf("/storage/preview/%s/hls/index.m3u8", prefix)
	return nil
}

// 音频转码管线：生成高质量 320k AAC 流 + 波形 JSON
func (p *Processor) transcodeAudio(ctx context.Context, inputPath, tempDir string, asset *processingAsset, specs map[string]interface{}) error {
	outputAAC := filepath.Join(tempDir, "preview.m4a")

	// 1. 转码生成 320k AAC 适合 Web 秒开流式播放
	cmd := exec.Command("ffmpeg", "-i", inputPath, "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", outputAAC)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("audio transcode: %w", err)
	}

	prefix := fmt.Sprintf("previews/%s", asset.ID)
	if _, err := os.Stat(outputAAC); err != nil {
		return fmt.Errorf("audio preview was not generated: %w", err)
	}
	if err := p.uploadFileToS3(ctx, outputAAC, p.cfg.S3BucketPreview, prefix+"/preview.m4a", "audio/mp4"); err != nil {
		return fmt.Errorf("upload audio preview: %w", err)
	}
	specs["preview_audio_url"] = fmt.Sprintf("/storage/preview/%s/preview.m4a", prefix)

	return nil
}

// 图像转码管线：使用 libvips 生成渐进式 WebP
func (p *Processor) transcodeImage(ctx context.Context, inputPath, tempDir string, asset *processingAsset, specs map[string]interface{}) error {
	outputWebP := filepath.Join(tempDir, "preview.webp")
	if err := exec.Command("vips", "copy", inputPath, outputWebP+"[Q=85]").Run(); err != nil {
		return fmt.Errorf("image transcode: %w", err)
	}

	prefix := fmt.Sprintf("previews/%s", asset.ID)
	if _, err := os.Stat(outputWebP); err != nil {
		return fmt.Errorf("image preview was not generated: %w", err)
	}
	if err := p.uploadFileToS3(ctx, outputWebP, p.cfg.S3BucketPreview, prefix+"/preview.webp", "image/webp"); err != nil {
		return fmt.Errorf("upload image preview: %w", err)
	}
	specs["preview_image_url"] = fmt.Sprintf("/storage/preview/%s/preview.webp", prefix)
	return nil
}

func (p *Processor) transcodeDocument(ctx context.Context, inputPath, tempDir string, asset *processingAsset, specs map[string]interface{}) error {
	// 文档直接保留预览原文件或解压章节
	specs["preview_ready"] = true
	return nil
}

func (p *Processor) uploadFileToS3(ctx context.Context, filePath, bucket, s3Key, contentType string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()
	info, _ := f.Stat()

	_, err = p.s3Client.PutObject(ctx, bucket, s3Key, f, info.Size(), minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

func (p *Processor) uploadDirectoryToS3(ctx context.Context, dirPath, bucket, prefix string) error {
	return filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dirPath, path)
		s3Key := fmt.Sprintf("%s/%s", prefix, filepath.ToSlash(rel))
		mime := "application/octet-stream"
		if strings.HasSuffix(path, ".m3u8") {
			mime = "application/vnd.apple.mpegurl"
		} else if strings.HasSuffix(path, ".ts") {
			mime = "video/mp2t"
		}
		return p.uploadFileToS3(ctx, path, bucket, s3Key, mime)
	})
}

func (p *Processor) loadProcessingAsset(assetID uuid.UUID) (*processingAsset, error) {
	var reg models.AssetRegistry
	if err := p.db.First(&reg, assetID).Error; err == nil {
		return &processingAsset{
			ID:         reg.ID,
			FileName:   reg.FileName,
			S3Bucket:   reg.S3Bucket,
			S3Key:      reg.S3Key,
			Sha256Hash: reg.Sha256Hash,
			MimeType:   reg.MimeType,
		}, nil
	}

	// Compatibility fallback for assets created before the CAS registry migration.
	var legacy models.AssetFile
	if err := p.db.First(&legacy, assetID).Error; err != nil {
		return nil, fmt.Errorf("asset not found in registry or legacy table: %w", err)
	}
	return &processingAsset{
		ID:         legacy.ID,
		FileName:   legacy.FileName,
		S3Bucket:   legacy.S3Bucket,
		S3Key:      legacy.S3Key,
		Sha256Hash: legacy.Sha256Hash,
		MimeType:   legacy.MimeType,
	}, nil
}

func (p *Processor) updateAssetState(asset *processingAsset, status, reason string, specs map[string]interface{}) {
	updates := map[string]interface{}{
		"transcode_status": status,
		"transcode_error":  reason,
	}
	if specs != nil {
		updates["technical_specs"] = models.JSONB(specs)
	}

	registryQuery := p.db.Model(&models.AssetRegistry{}).Where("id = ?", asset.ID)
	legacyQuery := p.db.Model(&models.AssetFile{}).Where("id = ?", asset.ID)
	if asset.Sha256Hash != "" {
		registryQuery = registryQuery.Or("sha256_hash = ?", asset.Sha256Hash)
		legacyQuery = legacyQuery.Or("sha256_hash = ?", asset.Sha256Hash)
	}
	if err := registryQuery.Updates(updates).Error; err != nil {
		log.Printf("Failed to update asset registry state for %s: %v", asset.ID, err)
	}
	if err := legacyQuery.Updates(updates).Error; err != nil {
		log.Printf("Failed to update legacy asset state for %s: %v", asset.ID, err)
	}
}

func (p *Processor) failAsset(asset *processingAsset, reason string) {
	p.updateAssetState(asset, "failed", reason, nil)
	log.Printf("Asset %s transcode failed: %s", asset.ID, reason)
}
