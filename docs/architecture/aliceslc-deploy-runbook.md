# aliceslc 线上部署手册与状态（findverse.cc）

> 更新时间：2026-09-08（UTC）。分支 `codex/catalog-v2-modular`，11 commits ahead of origin。

## 1. 线上现状（只读探针证据）

- 站点 `https://findverse.cc/`：200。
- `GET /api/catalog/definitions`：200，`base_version=1`，27 types，**无 `edition_type`**，23 relations。
- `GET /api/catalog/shelves`：200（旧硬编码端点仍在）。
- `POST /api/importer/preview`：**404**（导入器后端未上线）。
- 结论：线上跑的是本轮改动之前的版本，需部署以下提交：`b62d813`（版本类型学/去 v2 别名）、`8072e2d`（货架后台化/四语框架）、`c4e7fa5`（Semver）、`01f2f7f`（发行页/标题链）、`c30de5f`（去 v1 前缀）、`63eec77`（导入器）、`9cc997e`（文档）、`5dbc961`（回放测试）、`ada20aa`（企业级二期）、`706c3bc`（日繁 908 条）。

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

## 3. 阻塞点

本地 `~/.ssh` 只有 GitHub 用的 `id_ed25519`，SSH 握手确认服务端只接受 publickey，
`QwQ` 及 `root/alice/ubuntu/debian/admin/deploy/metafusion` 均 `Permission denied (publickey,password)`。
known_hosts 有该主机历史指纹，说明 historically 连过，但本机无对应私钥。
**需用户提供：aliceslc 的 SSH 用户名 + 对应私钥（或把本地公钥加进 authorized_keys）。**
在拿到之前不要反复重试密码/用户枚举。

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
