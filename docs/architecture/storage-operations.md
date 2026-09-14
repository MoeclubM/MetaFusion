# 资源存储运行约定

资源文件、哈希与实体绑定由独立存储服务（`metafusion-storage`）管理；目录只保存作品、表达与发行元数据，
通过实体 UUID 与文件建立引用。ISRC、MBID 是内容身份标识，**文件 SHA-256 不是**录音或作品身份。

## 部署与持久化

- 存储服务在 `deploy/docker-compose.yml` 中作为独立服务运行：`STORAGE_S3_*` 连接 RustFS，
  `STORAGE_ROOT=/app/storage-data` 挂载 `storage_data` 命名卷（上传暂存与本地对象模式）。
  目录（backend）不再持有任何归档变量与归档卷。
- 对象存储端口**不发布到宿主机**，只在 compose 网络内可达；浏览器直传需要让对象存储经反代对外可达，
  再设 `STORAGE_S3_PUBLIC_ENDPOINT` 指向该地址（见 `.env.example`）。
- **桶由存储服务启动时自己创建**（`internal/objects` 的 `ensureBucket`：先探测再建、并发下按已存在容忍）；
  不再有独立的一次性初始化容器——原 `minio/mc` 镜像已从 Docker Hub 撤下，拉不到会让整条部署链失败。
- 未配置 S3 端点时存储服务走**本地对象模式**：文件落在 `storage_data` 卷里，直传改由服务端流式接收。
- 目录侧与存储侧各用自有 schema（`catalog` / `storage`），**不跨 schema 建外键、不互相 JOIN**；
  实体可见性由存储服务向目录查询（`GET /api/catalog/entities/{id}`）后自行判定。
- 旧单体时代的 `ARCHIVE_*` 变量、`catalog_archive` 卷与 `modules.resources` 表随模块包一并退役（表已由
  `./deploy.sh retire` 删除）；若旧容器可写层里还有资产，需先备份再按哈希核验后迁移，新增卷不会自动搬运。

## 契约与权限口径

- 上传：`POST /api/storage/upload/initiate`（命中 sha256 即秒传，否则签发分片预签名地址）→ 客户端直传 →
  `POST /api/storage/upload/complete`；不可直传时用 `PUT /api/storage/upload/stream/{asset_id}`（服务端流式接收并边收边算哈希）。
- 绑定：`POST /api/storage/bind` 用 `binding_role` 表达用途（`track_audio`/`disc_image`/`video`/`scans`…），
  `DELETE /api/storage/bindings/{id}` 解绑纠错；收录位置（页码、时间码）留在目录侧的 `locator`，两处不重复。
- 读取可见性只有一条口径：**上传者本人或管理员直通，其余人只要任一绑定目标实体可见即可读**；
  下载、元数据读取与哈希校验共用该判定（`GET /api/storage/download/{asset_id}`、`GET /api/storage/entities/{id}/files`）。
- 下载在 S3 模式下返回预签名地址，本地模式由服务端流式下发；`/storage/preview/` 仍返回 404，不直代私有桶。

## 已知缺口（拆分过程中尚未迁入存储服务）

- 媒体分析与预览：原 `/api/media/*`（ffprobe 分析、预览转码）**尚未迁移**，当前不可用；
  迁移时归存储服务（对象内容在那里）。
- BT 种子、分享率治理、零拷贝（对象存储内部拷贝）等仍属未确认需求，不作为前提。

## 变更纪律

- 存储服务自带幂等 DDL 建表；**版本化迁移**仍是待补项（与目录侧的 `backend/migrations` 不同轨）。
- 存储侧与目录侧的接口只有一条：实体可见性查询（`GET /api/catalog/entities/{id}`，实体已合并时再取
  `/api/catalog/entities/{id}/resolve` 跟随重定向）。任何"直接读对方表"的做法都应被拒绝。
- 身份解析不走目录服务：存量不透明令牌的兜底问账号服务（`AUTH_URL` 的 `GET /api/auth/me`），
  目录只提供验签公钥（JWKS 在账号服务）。
