# MetaFusion 核心实现与模块边界

面向编目者的模型、例子与端点见 [编目教程](https://github.com/MoeclubM/metafusion-docs/blob/main/docs/catalog.md)（文档在独立仓库 `metafusion-docs`）。

核心位于 `backend/internal/catalog`：统一实体注册表（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）、类型专用结构表、动态定义、修订、outbox 与站内通知收件箱（`catalog.notifications`，迁移 `000003_notifications`，读投递见 `/api/notifications/*`）；账号、会话与令牌归 `metafusion-auth`，目录侧只做 RS256 验签、不保存账号数据。所有核心写事务共用 advisory lock，乐观版本避免静默覆盖；复合外键和延迟触发器拒绝跨域父子和循环。该首版串行化核心写入，适合中小规模协作站；高写入量时需要按受影响图范围缩小锁粒度。

`cmd/server/main.go` 作为纯净的单一启动入口：核心依赖 PostgreSQL；OpenSearch 是可选的实体搜索候选索引，不影响目录启动与编辑。配置 `OPENSEARCH_URL` 后，后台先从目录实体表建立索引，再按 `entity.*` 事件消费同事务写入的 `catalog.outbox`；消费者用 PostgreSQL advisory lock 保证多后端副本只有一个索引器，bulk 写入等待 refresh 以缩短可见性延迟。索引文档覆盖题名、翻译、摘要、别名、标签和外部 ID，状态代际变更时自动清理并重建候选索引；搜索候选仍由 PostgreSQL 复核子串命中、外部 ID、可见性、筛选并读取实体。索引未就绪/不可用、查询无索引命中、结构关系/自定义字段筛选或匹配量超过 10,000 时回退原 PostgreSQL 搜索。未配置时检索完全走 PostgreSQL。Redis 与 S3 不由目录核心强制初始化。

外围能力（账号、互动、存储）由独立服务承担：它们不持有指向核心表的外键，只能通过 HTTP 契约查询实体与提交提案。合并事件包含旧 ID 和目标 ID；outbox 与修订同事务写入、去重按事件 ID 幂等。OpenSearch 是目前唯一生产 outbox 消费者；跨业务服务事件仍靠同步查询目录接口收敛，见迁移基准 §3。

前端 `/catalog` 使用独立 CatalogProvider，根布局不挂载全局播放器。资源、社区与个人记录组件动态导入，先检查能力再请求自己的 API。外部图片以带来源的核心引用保存，文件模块关闭不影响封面。

`pictures[]` 是有序数组：**数组顺序即展示顺序、首张即封面**，服务端不重排（`taken_at` 只是该图自身的时间元信息，曾在前端被当作排序键，那会静默覆盖作者定的顺序，已收敛）。"哪张是封面"在前端只有 `src/lib/cover.ts` 一处判定（`coverPicture` / `coverUrl`），列表、搜索、OG、对比与署名等消费点都走它，不再各自 `[0]`。每张图可选 `role`（`picture_role` 词表的用途码，标签按 locale 从 definitions 解析，不硬编码文案）与 `asset_id`（自托管封面的存储资产 UUID，配 `binding_role=cover_image`，地址见 [存储运行约定](storage-operations.md)）；写侧的重复 URL、张数封顶与词表合法性由 `validation.go` 判定，需求口径见 `docs/requirements.md` 的 MEDIA-05。

部署使用标准 `deploy/docker-compose.yml`。API 统一使用 `/api` 单一命名空间。
