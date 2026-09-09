# MetaFusion 核心实现与模块边界

面向编目者的模型、例子与端点见 [编目教程](../../docs-site/docs/catalog.md)。

核心位于 `backend/internal/catalog`：统一实体注册表（Agent, Collection, Work, ContentUnit, Expression, Release, Medium, Track）、类型专用结构表、动态定义、独立身份会话、修订与 outbox。所有核心写事务共用 advisory lock，乐观版本避免静默覆盖；复合外键和延迟触发器拒绝跨域父子和循环。该首版串行化核心写入，适合中小规模协作站；高写入量时需要按受影响图范围缩小锁粒度。

`cmd/server/main.go` 作为纯净的单一启动入口：核心仅依赖 PostgreSQL。核心不强制初始化 Redis、S3 或 OpenSearch。外围初始化失败只影响能力接口和外围路由，目录仍可正常启动与编辑。

`moduleapi` 为稳定 DTO 接口，`moduledeps` 为独立 Semver/DAG 库。模块表没有指向核心表的外键，模块只能通过 Catalog 接口查询实体和提交提案。合并事件包含旧 ID 和目标 ID；outbox 与修订同事务，消费采用至少一次投递和事件 ID 去重。

前端 `/catalog` 使用独立 CatalogProvider，根布局不挂载全局播放器。资源、社区与个人记录组件动态导入，先检查能力再请求自己的 API。外部图片以带来源的核心引用保存，文件模块关闭不影响封面。

部署使用标准 `deploy/docker-compose.yml`。API 全量统一切换为标准 `/api` 单一命名空间，不再保留旧版过渡别名。
