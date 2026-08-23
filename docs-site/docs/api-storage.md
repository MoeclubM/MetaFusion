---
title: "上传与下载"
description: "经 API 直传 S3 与获取预签名下载链接。"
order: 35
group: "api"
---

# 上传与下载

全部需认证，直传链路与前端上传器一致。

## 初始化（秒传检测）

```http
POST /api/v1/storage/upload/initiate
Authorization: Bearer <token>
Content-Type: application/json

{
  "file_name": "track.flac",
  "file_size": 12345678,
  "sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "mime_type": "audio/flac",
  "release_id": "<uuid>"
}
```

响应：

```json
{ "s3_key": "masters/<uuid>/track.flac", "upload_urls": ["https://s3-storage/...?X-Amz-Signature=..."], "dedup": false }
```

- `dedup: true` 表示 SHA-256 命中秒传，可跳过 PUT 直接 `complete`
- `upload_urls` 为预签名分片 URL，客户端并发 PUT

## 直传

```bash
curl -X PUT "<upload_url>" --data-binary @track.flac -H "Content-Type: audio/flac"
```

不经过 Go 后端，绕过业务服务。

## 完成

```http
POST /api/v1/storage/upload/complete
{ "s3_key": "masters/...", "file_name": "track.flac", "mime_type": "audio/flac", "release_id": "..." }
```

服务端落库 `asset_files` 并投递转码任务。

## 下载

```http
GET /api/v1/storage/download/:asset_id
Authorization: Bearer <token>
→ { "download_url": "https://.../masters/...?X-Amz-Signature=...&response-content-disposition=attachment%3B%20filename%3D..." }
```

链接 2 小时有效，`response-content-disposition` 带文件名与后缀。

## 预览流

预览切片（HLS `index.m3u8` / `segment_*.ts`、音频 `preview.m4a`、图像 `preview.webp`）同样需认证，当前经 Nginx `/storage/preview/` 代理到 `metafusion-preview` 桶。生产建议改为预签名链路。

## 限流与审计

- 对 `L1` 上传/下载接口施加速率限制（网关层）
- 访问经 `admin_audit_logs` 记录
