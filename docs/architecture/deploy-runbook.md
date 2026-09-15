# 线上部署手册与状态（findverse.cc）

> 更新时间：2026-09-14（UTC）。线上 `/root/metafusion` 已在 `codex/storage-history-cleanup` 上完成子系统切流
> （账号 / 互动 / 存储三服务 + 网关，`./deploy.sh cutover`）并清掉拆分前的遗留结构（`./deploy.sh retire`）。
>
> **运维事实不在本文**：机器、连接方式、服务器注意事项等只在本机（不进版本库）的 `docs-local/` 里；
> 本文只保留**已经发生过的部署动作记录**与验证清单，避免与 `docs-local/` 重复维护。


## 0.2 封面与关系扩展上线（2026-09-10 第三轮）

- 修复导入器封面丢失：`buildWorkEntity` / `buildAgentEntity` / staff 关联此前完全不写 `Pictures`
  （仅透传 URL 不落库），导致页面只剩程序占位图。新增 `pictureFromRemote` 把远端图 URL 透传为
  `Picture`（`Source` 指向 Bangumi 条目页/角色页，满足 `validateSources` 证据规则；不抓取、不转存）。
- 扩展分媒介署名关系（`Defaults()`，group=credits，目标 agent）：`composed_by` 作曲、`lyricist_of` 作词、
  `arranged_by` 编曲、`directed_by` 导演、`written_by` 编剧、`illustrated_by` 插画、`narrated_by` 朗读。
  线上 relations 由 17 增至 24，重播方式同 0.1（`DELETE definitions` + 重启 backend）。
- 回填四个实体封面（Bangumi 官方图，透传远端 URL）：4114 / 3559 / 428735 / 200841，`pictures=1` 各一条。
  页面确认作品页封面按自然比例渲染（1140×1540 原图，无拉伸）。
- 说明：本机无 docker，无「本地测试部署」可清理；所谓清理按用户意图执行的是线上目录数据重建（见 0.0 节）。

## 0. 线上数据重建与 Bangumi 导入记录（2026-09-10 第二轮）

用户明确线上数据不重要、可重建，执行了目录数据清空重建 + Bangumi 测试导入。

- 清空（保留 users/sessions/oauth/shelves 配置）：`TRUNCATE catalog.entities CASCADE`、
  `TRUNCATE catalog.outbox CASCADE`、`TRUNCATE catalog.relations`、`TRUNCATE catalog.revisions`、
  `DELETE FROM catalog.definitions`；随后 `docker restart metafusion-backend` 触发 `Initialize()`
  用新 `Defaults()` 重新播种 definitions。
- 词表验证：`edition_type` 已含 `deluxe/boxset`，`distribution_channel` 词表存在，release 类型字段含
  `distribution_channel`（0.1 待办已随重建完成）。
- 导入（走 `/api/importer/preview` + `/import`，admin 会话，导入后逐个 publish）：
  - `subject/4114` AIR Original SoundTrack → work `8b051d93-2c3c-4027-9e2a-a1da6648a724`，type `music`
  - `subject/3559` 魔法禁书目录 → work `5e32da46-a103-4ed7-a406-52a974d0aca0`，type `novel`
  - `subject/428735` BanG Dream! It's MyGO!!!!! → work `2687a683-b0b3-44f6-ada9-6a0d3cf41b2e`，type `animation`
  - `character/200841`（Bangumi 把 MyGO!!!!! 乐队挂在角色表当"配角"）→ agent `d0ac4ac1-ea43-4575-ae53-e138626d2ae8`，**type `group`**
  - 关系：`performed_by`，work `2687a68…` → agent `d0ac4ac…`（用新数据结构把团体表达为实体 + 关系，而非角色）
- 线上最终状态：entities=4、relations=1、definitions=1。
- 页面验证：`/`、三个 `/works/<id>`、`/artists/<band>` 全 200；作品页演职员区显示
  `表演者: MyGO!!!!!` 链到 group 实体，非配角角色卡；关系名按 `Accept-Language` 本地化
  （zh-CN「表演者」/ en-US「Performed by」）。
- 顺带修复并上线：`catalog/works/:id`、`/contents`、`/graph` 旧前端兼容只读路由（`works_compat.go`）；
  兼容层按请求身份解析关系对端（草稿可见性）；关系名走服务端词表本地化。
  > 该兼容层与下列路由已于 **2026-09-13 随旧轨整段删除**（系统未上线，无需兼容旧数据）：`/catalog/works`、`/catalog/works/:id`、`/works/:id/{contents,graph}`、`/taxonomy`、`/artists/:id`、`/franchises/:id`、`/mediums/:id`、`/canonical-entries/:id`、`/relation-types`、`/works/:id/comments`。现统一走 `/api/catalog/entities` 系；两个坑（关系端身份可见性、客户端关系名本地化）在 `/api/catalog/entities/:id/relations` + definitions 上仍然适用。

## 0.1 已消解：Definitions 词表升级

原先的待办已通过本轮「清空 definitions + 重启 server 重新播种」达成，线上词表现与代码 `Defaults()` 一致。
今后若只想升级词表而不清数据，仍走后台 DefinitionsEditor 草稿 → impact 预演 → 发布。

## 1. 线上现状（只读探针证据）

- 站点 `https://findverse.cc/`：200。
- `GET /api/catalog/definitions`：200（新 `Defaults()` 词表）。
- `GET /api/catalog/shelves`：200（DB 规则 shape）。
- `POST /api/importer/preview`：**200**（导入器后端已上线）。

## 2. 部署链路

生产机是一台独立主机（SSH 22 端口）。**主机名、用户名、认证方式一律不入库**：它们只写在 `docs-local/deploy/server-connection.md`，仓库内只保留不带连接信息的部署步骤。
CI（`.github/workflows/ci.yml`）只有构建+测试，无部署步骤；仓库 secrets 为空。
`deploy/` 支持下面几种更新方式（均需机器 SSH 权限）：

```bash
# A. 源码构建更新（需 Go/Node 环境，有构建耗时）
./deploy.sh fast backend frontend     # 也可只给一个服务名
./deploy.sh migrate up               # 有新的目录库迁移时必须补跑

# B. 预构建镜像更新（需 GHCR 可达，先合入 main 触发 release.yml 构建）
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans

# C. 首次切换到拆分后的架构（只走一次）与遗留结构清理
./deploy.sh cutover    # 构建 → 起基础设施与各子系统 → 目录库迁移 → 搬运旧表 → 最后拉起网关
./deploy.sh retire     # 切流验证通过后：删 modules / media schema、catalog.favorites、临时备份表
```

拆分后部署需要**三个子仓库与主仓库并列检出**（`/root/metafusion-auth`、`-community`、`-storage`），
否则 compose 的跨仓库构建上下文不存在、这三个服务拉不起来。

**`fast` 不会自动执行迁移**（只有 `prod` / `pull` 会）。历史结构退役、账号表搬迁等一次性数据迁移
现在都在 `backend/migrations/`（结构只剩单一基线 `000001_catalog_core`，启动与迁移读同一份），因此拉取含新迁移的代码后
必须补跑一次 `./deploy.sh migrate up`，否则这些变更不会生效。

网关：`deploy/nginx.conf`，按前缀分流——`/api/catalog|capabilities|exchange|importer|openapi.json` 与 `/api/*` 兜底走
`backend:8080`，`/api/setup`、`/api/auth/`、`/api/admin/users`、`/api/oauth/`、`/api/oidc/`、`/api/.well-known/` 走 `auth:8081`，
`/api/community/`、`/api/favorites/`、`/api/records/`、`^/api/users/[^/]+/favorites$` 走 `community:8083`，
`/api/storage/` 走 `storage:8082`，`/docs` 走 `docs-site:3001`，其余走 `frontend:3000`。
判定分流是否生效看响应头 `X-MetaFusion-Service`（`metafusion-catalog` / `-auth` / `-community` / `-storage`）。
**改完 `nginx.conf` 必须重载网关**（文件挂载，compose 不会因文件内容变化重建容器）：
`docker exec metafusion-gateway nginx -t && docker exec metafusion-gateway nginx -s reload`。

## 3. SSH 访问（已解决）

服务端接受 `publickey,password`。认证方式与凭据来源只记在 `docs-local/deploy/server-connection.md`；**任何情况下不要把"用户名 + 口令"的组合、私钥内容或凭据文件原文写进仓库**。
注意机器别名不是 SSH 用户名：直接把别名当用户名登录会 `Permission denied`。
本地密钥未加入服务器 `authorized_keys` 时按 `docs-local/deploy/server-connection.md` 处理；不要在仓库里描述认证细节，也不要对生产机做账号枚举。

## 4. 部署后验证清单（上线后执行）

```bash
curl -s https://findverse.cc/api/catalog/definitions | grep -o edition_type   # 有输出
curl -s -X POST https://findverse.cc/api/importer/preview \
  -H 'Content-Type: application/json' \
  -d '{"source":"bangumi","url_or_id":"45638","entity_type":"artist"}'        # 200 + 预览体
curl -s "https://findverse.cc/api/catalog/shelves"                            # DB 规则 shape
curl -sI https://findverse.cc/ | head -n 1                                    # 200
```

再走真人链：登录 → 导入器输 `https://bangumi.tv/person/45638` → preview → import →
回读 work/agent → 建 `voiced_by/performed_by` → occurrences 反查 → 四语标题检查
（ja-JP / zh-TW / en-US 切换无裸 key）。

切流后的分流自检（逐条打印前缀落到了哪个上游）：

```bash
for p in /api/catalog/definitions /api/setup /api/auth/settings /api/community/boards /api/favorites/status /api/storage/stats; do
  printf '%-32s %s\n' "$p" "$(curl -s -o /dev/null -D - http://127.0.0.1:10100$p | tr -d '\r' | awk -F': ' 'tolower($1)=="x-metafusion-service"{print $2}')"
done
# 期望：catalog / auth / auth / community / community / storage
```

## 5. 回滚

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans  # 指定旧 IMAGE_TAG
```

迁移 `000002_catalog_shelves` 有 down SQL；Definitions 发布走后台 impact 预演，可退回旧版。

**切流后的回滚边界**：`./deploy.sh retire` 执行之后，旧表（`modules.*`、`catalog.favorites`）已经不存在，
互动与存储不再有"搬回单体"的回滚路径，回滚只剩"改网关上游 + 用上一版镜像重建那一个服务"；
切流前的 `pg_dump` 备份在同机 `/root/metafusion-backups/` 下。
