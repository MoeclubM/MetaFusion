---
title: "上传与下载"
description: "经 API 直传 S3 与获取预签名下载链接。"
order: 35
group: "api"
---

# 上传与下载

全部需认证，直传链路与前端上传器一致。基于内容寻址存储（CAS），文件经 SHA-256 去重，元数据与物理资产完全解耦。

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
  "part_count": 3,
  "target_entity_type": "track",
  "target_entity_id": "<uuid>",
  "binding_role": "track_audio"
}
```

字段说明：
- `part_count`（必填，>= 1）：待上传分片总数
- `sha256_hash`（必填）：客户端本地计算的 64 位十六进制 SHA-256 校验和
- `target_entity_type` / `target_entity_id`（可选）：挂载目标实体类型（`medium` / `track` / `canonical_entry` / `release` / `work`）与 UUID
- `binding_role`（可选，默认 `master_archive`）：绑定用途（`track_audio` / `disc_image` / `scans` / `video` 等）

响应：

```json
{
  "is_instant_upload": false,
  "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "upload_id": "VXBsb2FkIElE...",
  "s3_key": "masters/9b1deb4d-.../track.flac",
  "presigned_urls": [
    "http://rustfs:9000/metafusion-master/masters/...?partNumber=1&uploadId=...",
    "http://rustfs:9000/metafusion-master/masters/...?partNumber=2&uploadId=...",
    "http://rustfs:9000/metafusion-master/masters/...?partNumber=3&uploadId=..."
  ]
}
```

- `is_instant_upload: true` 表示 SHA-256 命中秒传，直接完成实体绑定，无需 PUT 与 complete 步骤；
- `is_instant_upload: false` 时返回各分片的预签名 `presigned_urls`，客户端可并发 PUT 直传。

## 直传分片

```bash
# 各分片直传至 RustFS (S3)，PUT 完成后从 ETag 响应头获取分片哈希
curl -X PUT "<presigned_url_1>" --data-binary @part_1.bin
```

不经过 Go 后端业务服务器，不消耗业务 API 带宽。

## 完成分片合并

分片上传完毕后，调用 complete 接口触发 S3 分片合并与后台异步转码：

```http
POST /api/v1/storage/upload/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "upload_id": "VXBsb2FkIElE...",
  "s3_key": "masters/9b1deb4d-.../track.flac",
  "parts": [
    { "PartNumber": 1, "ETag": "\"etag-from-part1-response\"" },
    { "PartNumber": 2, "ETag": "\"etag-from-part2-response\"" },
    { "PartNumber": 3, "ETag": "\"etag-from-part3-response\"" }
  ]
}
```

服务端在对象存储完成 Multipart 合并，并自动投递 Asynq 异步转码任务（HLS 切片、320k 预览音频、关键帧雪碧图等）。

## 资产实体挂载 (Bind)

已存在的独立 CAS 资产可自由绑定到其他实体：

```http
POST /api/v1/storage/bind
Authorization: Bearer <token>
Content-Type: application/json

{
  "asset_id": "<uuid>",
  "target_entity_type": "track",
  "target_entity_id": "<uuid>",
  "binding_role": "track_audio"
}
```

## 下载原档

```http
GET /api/v1/storage/download/:asset_id
Authorization: Bearer <token>

→ { "download_url": "http://rustfs:9000/metafusion-master/masters/...?X-Amz-Signature=...&response-content-disposition=attachment%3B%20filename%3D..." }
```

下载链接 2 小时有效，带有时效签名与 `response-content-disposition` 文件名。

## 限流与审计

- 上传与下载全流程受后端 `internal/ratelimit` 滑动窗口限流保护；
- 敏感资产操作记录于 `admin_audit_logs`。
