---
title: "上传与下载"
description: "内容寻址存储、分片直传、绑定用途与读取可见性。"
order: 35
group: "api"
---

::: tip 状态
本页描述的 `/api/storage/*` **契约已由独立服务 `metafusion-storage` 实现**（源码见其仓库 `internal/handler/`）。
线上实例能否访问该前缀，取决于部署状态：网关把 `/api/storage/` 指向存储服务，服务未启动时该前缀不可用。
旧的 `archive` / `playback` / `media` 模块已随主工程模块层退役。
:::

文件本体、哈希与绑定由存储服务负责，目录只保存作品、表达与发行元数据：两者用实体 UUID 互指，
存储侧**不复制**目录数据，目录侧**不保存**对象存储物理路径。基于内容寻址（SHA-256）去重，元数据与物理资产完全解耦。

除标注"匿名可用"的接口外都需要登录（`Authorization: Bearer <token>` 或 HttpOnly Cookie `mf_session`）。

## 初始化（秒传检测）

```http
POST /api/storage/upload/initiate
Authorization: Bearer <token>
Content-Type: application/json

{
  "file_name": "track.flac",
  "file_size": 12345678,
  "sha256_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "mime_type": "audio/flac",
  "part_count": 3,
  "target_entity_id": "<uuid>",
  "binding_role": "track_audio"
}
```

字段说明：

- `sha256_hash`（必填）：客户端本地计算的 64 位十六进制 SHA-256，是文件的**身份**；
- `part_count`（可选，默认 1）：分片数量，>1 时返回每个分片的预签名地址；
- `target_entity_id`（可选）：同时绑定到该实体，必须对调用者可见；`target_entity_type` 若填写，必须与目录给出的 kind 一致；
- `binding_role`（可选，默认 `master_archive`）：绑定用途，取值匹配 `^[a-z][a-z0-9_]{0,31}$`，
  例如 `track_audio`、`disc_image`、`video`、`scans`；不设封闭枚举，新增用途不需要改代码。

响应：

```json
{
  "is_instant_upload": false,
  "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "object_key": "objects/9b/9b1deb4d-…/track.flac",
  "upload_id": "VXBsb2FkIElE…",
  "presigned_urls": ["https://<对象存储对外地址>/metafusion-master/objects/…?partNumber=1&uploadId=…"],
  "part_size_hint": 4115226,
  "expires_at": "2026-09-15T10:00:00Z"
}
```

- `is_instant_upload: true`：该 SHA-256 已存在（秒传），无需再上传，直接进入绑定；
- 同一 SHA-256 的**未完成上传由上传者本人续传**（复用同一次分片会话）；他人重传会得到 `409 upload_in_progress`；
- 未配置对象存储端点时是**本地对象模式**：不返回预签名地址，而是给出 `direct_upload_url`，
  客户端把原始字节 `PUT` 到该地址即可（服务端边收边算 SHA-256 并校验）。

## 直传分片（浏览器/客户端 → 对象存储）

```bash
# 各分片直接 PUT 到预签名地址，完成后从响应头 ETag 取值回传
curl -X PUT "<presigned_url_1>" --data-binary @part_1.bin
```

不经过业务服务器，也不消耗业务 API 带宽。预签名 URL 的 host 参与签名，因此**对象存储必须从客户端可达**：
编排里对象存储端口默认不对宿主机开放，需要浏览器直传时应经反代暴露并设置 `STORAGE_S3_PUBLIC_ENDPOINT`。

## 完成上传

```http
POST /api/storage/upload/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "asset_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "upload_id": "VXBsb2FkIElE…",
  "parts": [
    { "part_number": 1, "etag": "\"etag-from-part1\"" },
    { "part_number": 2, "etag": "\"etag-from-part2\"" }
  ]
}
```

服务端在对象存储完成 Multipart 合并，并以 HEAD 回读得到**实际大小**（S3 的合并响应体里没有长度），
与 `file_size` 不一致时返回 `409 size_mismatch`。`upload_id` 省略时使用该资产已记录的分片会话。

::: warning 尚未实现
异步转码投递（HLS/预览音频/雪碧图）**没有**在存储服务中实现；原 `media` 模块的探针与预览转码在拆分中退役，属已知缺口。
:::

## 绑定与解绑

```http
POST /api/storage/bind
Authorization: Bearer <token>

{ "asset_id": "<uuid>", "target_entity_id": "<uuid>", "binding_role": "track_audio" }

DELETE /api/storage/bindings/{binding_id}
```

绑定表达的是"这份文件是谁的什么用途"；收录位置（页码、时间码、路径）留在目录侧的 `locator`，两处不重复。
同一 `(asset, entity, role)` 只保留一条；解绑用于纠错，绑定创建者、文件上传者或管理员都可以操作。

## 查询与下载

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/storage/entities/{id}/files` | 实体可见 | 「这个介质/轨道/表达上挂了哪些文件」入口 |
| GET | `/api/storage/assets/{id}` | 可读 | 文件元数据与绑定列表 |
| GET | `/api/storage/download/{asset_id}` | 可读 | 对象存储模式返回预签名地址；本地模式直接流式下发 |
| POST | `/api/storage/verify-hash` | 匿名可用 | 只给 `sha256_hash` 是秒传探测；给 `asset_id` 则读回重算并比对 |
| GET | `/api/storage/stats` | 管理员 | 完成态文件数与占用字节 |

```http
GET /api/storage/download/{asset_id}

→ { "download_url": "https://…?X-Amz-Signature=…&response-content-disposition=attachment%3B%20filename%3D…",
    "file_name": "track.flac", "size_bytes": 12345678, "sha256": "…", "expires_at": "…" }
```

**读取可见性只有一条口径**：上传者本人或管理员直通，其余人只要**任一绑定目标实体可见**即可读。
下载、元数据读取与哈希校验共用该判定，不会出现"能下载但不能预览"这类口径差异。
不可读一律返回 404，不区分"无权限"与"不存在"，避免泄露他人上传的存在性。

## 限流与审计

- 上传与下载经网关转发；网关对既有 `/api/` 路径限流，`/api/storage/` 为避免误伤大文件分片上传**不限流**；
- 目录侧的写入审计仍按编目流程记录；存储服务当前没有独立的操作审计表（缺口）。
