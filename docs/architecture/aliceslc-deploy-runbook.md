# aliceslc 线上部署手册与状态（findverse.cc）

> 更新时间：2026-09-10（UTC）。线上 `~/metafusion` 已到 `main` `8c673fe`。

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

## 0.1 已消解：Definitions 词表升级

原先的待办已通过本轮「清空 definitions + 重启 server 重新播种」达成，线上词表现与代码 `Defaults()` 一致。
今后若只想升级词表而不清数据，仍走后台 DefinitionsEditor 草稿 → impact 预演 → 发布。

## 1. 线上现状（只读探针证据）

- 站点 `https://findverse.cc/`：200。
- `GET /api/catalog/definitions`：200（新 `Defaults()` 词表）。
- `GET /api/catalog/shelves`：200（DB 规则 shape）。
- `POST /api/importer/preview`：**200**（导入器后端已上线）。

## 2. 部署链路

生产机 `alice-slc-premium-01.telecom.moe`（22 端口开放，IPv6 可达，仅 publickey 认证）。
CI（`.github/workflows/ci.yml`）只有构建+测试，无部署步骤；仓库 secrets 为空。
`deploy/` 支持两种生产更新方式（均需机器 SSH 权限）：

```bash
# A. 源码构建更新（需 Go/Node 环境，有构建耗时）
./deploy.sh fast backend frontend
./deploy.sh migrate up   # 000002_catalog_shelves 等迁移

# B. 预构建镜像更新（生产推荐，需 GHCR 可达，先合入 main 触发 release.yml 构建）
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
```

网关：`deploy/nginx.conf`，`/api/*` 直通 backend:8080，无重写（前端已去 v1 前缀，直接对齐）。

## 3. SSH 访问（已解决）

服务端接受 `publickey,password`。`root` + 密码可登录（凭据在 `D:\NET\machine.md`，更新时间 2026-09-01）。
注意 `aliceslc` 不是 SSH 用户名，只是机器别名——用 `aliceslc` 登录会 `Permission denied`。
本地 `id_ed25519` 公钥未加入服务器 `authorized_keys`，密码登录即可，勿做用户/密码枚举。

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

## 5. 回滚

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans  # 指定旧 IMAGE_TAG
```

迁移 `000002_catalog_shelves` 有 down SQL；Definitions 发布走后台 impact 预演，可退回旧版。
