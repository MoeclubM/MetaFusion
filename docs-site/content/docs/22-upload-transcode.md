---
title: "上传与转码"
description: "分片直传、秒传、预签名下载与多媒介转码管线。"
order: 22
group: "guide"
---

# 上传与转码

## 架构

- 控制面与数据面分离：客户端经预签名 URL 直传 MinIO/S3，绕过 Go 服务
- 双桶：`metafusion-master`（原档冷桶）、`metafusion-preview`（切片热桶）
- 全文件 SHA-256 秒传去重：命中则复用 `s3_key/technical_specs`，仍需登录，不复用他人鉴权

## 上传三步

### 1. 初始化

```http
POST /api/v1/storage/upload/initiate
Authorization: Bearer <JWT|PAT>
Content-Type: application/json

{ "file_name": "track.flac", "file_size": 12345678, "sha256_hash": "abc...", "mime_type": "audio/flac", "release_id": "<uuid>" }
```

响应：

```json
{ "s3_key": "masters/<uuid>/track.flac", "upload_urls": ["https://..."], "dedup": false }
```

若 `dedup: true`，表示命中秒传，已有文件可直接进入完成阶段。

### 2. 直传 S3

客户端并发分片 PUT 至 `upload_urls`（预签名 URL），不经过后端。

### 3. 完成

```http
POST /api/v1/storage/upload/complete
{ "s3_key": "masters/...", "file_name": "track.flac", "mime_type": "audio/flac", "release_id": "..." }
```

服务端校验、落库 `asset_files`，并投递 Asynq 转码任务。

## 下载

```http
GET /api/v1/storage/download/:asset_id
Authorization: Bearer <JWT|PAT>
→ { "download_url": "https://minio/...?X-Amz-Signature=..." }  # 2h 有效，带 Content-Disposition
```

> 全部需认证。匿名请求返回 401，前端 `GlobalAudioPlayer`/`VideoPlayer` 在 401 时弹出登录。

## 转码管线（Worker）

Go Asynq Worker 消费队列，调用 FFmpeg / libvips / mediainfo：

- **影视/动画**：自适应 HLS (`index.m3u8` + `segment_*.ts`) + 雪碧图 Seek 预览
- **音频**：320k 预览流 + 波形图，Hi-Res 原档保留
- **图书/漫画**：EPUB/PDF 流式阅读 + 渐进式 WebP 双页阅览
- **通用**：`technical_specs`（编码、码率、HDR、声道等）

预览切片经 Nginx `/storage/preview/` 代理分发，缓存 30 天。生产建议将该路径切换为需鉴权的预签名链路（见 `docs/requirements.md MEDIA-02`）。

## 前端入口

`src/components/` 中的上传器与 `GlobalAudioPlayer` 已封装上述链路；API 用户可直接用 `curl` 复现。

## 限流

对 `L1` 预签名接口与上传初始化施加速率限制（网关层），匿名 60/min，认证 600/min，响应头含 `X-RateLimit-*`。
