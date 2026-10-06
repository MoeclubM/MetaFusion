# 能力清单（GET /api/capabilities）

响应形状：

```json
{"modules":[{"id":"exchange","enabled":true},{"id":"community","enabled":false}]}
```

## 语义

- **这是部署态声明，不是健康探测**：`enabled` 只看部署配置（`COMMUNITY_URL` / `STORAGE_URL` 是否配置），
  `exchange` 由目录自身提供，恒为 true。
- 目录服务**不发任何出站请求**：健康与可用性由网关/运维面各自读各服务的 `GET /health`、
  `GET /ready` 判断（见 [部署与恢复手册](./deployment-runbook.md)）。因此清单里没有 `healthy`、`version`、
  `dependencies` 这类拆分前模块注册表的字段——上游全挂时清单照样只反映部署事实。
- 前端与定义编辑器只按 `id` + `enabled` 决定区块显隐（详情页的社区区块、控制台的子系统面板）。

能力由部署配置决定，没有运行时模块开关；要启用对应区块，部署并配置该服务。

服务归属与剩余边界工作见[拆分契约](./service-split-migration.md)，本页只维护能力清单语义。
