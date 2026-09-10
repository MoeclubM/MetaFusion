# aliceslc 线上部署手册与状态（findverse.cc）

> 更新时间：2026-09-10（UTC）。线上 `~/metafusion` 已到 `main` `466e801`（含通用多媒体架构修复与残留收敛）。

## 0. 部署记录（2026-09-10）

- 认证：SSH `root` + 密码登录（凭据在 `D:\NET\machine.md` / `machine_credentials.md`；密码不进仓库）。
  注意：用户名是 `root`，不是 `aliceslc`（`aliceslc` 只是机器别名）。
- 步骤：`git pull origin main` → `bash deploy.sh fast backend` → `bash deploy.sh fast frontend` →
  `bash deploy.sh restart backend frontend` → `bash deploy.sh migrate up`（000001/000002 均已 APPLIED，无 pending）。
- 宿主机无 go/node/npm，构建全部在 Docker 多阶段构建内完成；`deploy.sh` 在服务器上无执行位，用 `bash deploy.sh` 调用。
- 验证结果：首页 `HTTP/2 200`；`POST /api/importer/preview` **200**（此前 404）；
  `GET /api/catalog/shelves` 返回 DB 规则 shape；`GET /api/catalog/definitions` 200。

## 0.1 待办：线上 Definitions 词表升级

线上 definitions 仍是旧已发布文档（`edition_type` 仅 6 词条，无 `deluxe/boxset`，无 `distribution_channel` 词表）。
这是设计行为：`Defaults()` 种子只在 definitions 表为空时写入，代码新增词表不会自动覆盖已发布文档。
升级路径（走规范流程，不改库）：admin 登录后台 → DefinitionsEditor 基于当前文档补
`edition_type` 的 `deluxe/boxset` 与新增 `distribution_channel` 词表 → impact 影响预演 → 发布。
前端在词表发布前用 `release.editionType.*` i18n 兜底显示，无裸 key。

## 1. 线上现状（只读探针证据）

- 站点 `https://findverse.cc/`：200。
- `GET /api/catalog/definitions`：200（旧发布文档，见 0.1 待办）。
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
