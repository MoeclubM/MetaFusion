# 能力清单（GET /api/capabilities）

响应形状：

```json
{"modules":[{"id":"exchange","enabled":true},{"id":"community","enabled":false}]}
```

## 语义

- **这是部署态声明，不是健康探测**：`enabled` 只看部署配置（`COMMUNITY_URL` / `STORAGE_URL` 是否配置），
  `exchange` 由目录自身提供，恒为 true。
- 目录服务**不发任何出站请求**：健康与可用性由网关/运维面各自读各服务的 `GET /health`、
  `GET /ready` 判断（见 [切流手册](./cutover-runbook.md)）。因此清单里没有 `healthy`、`version`、
  `dependencies` 这类拆分前模块注册表的字段——上游全挂时清单照样只反映部署事实。
- 前端与定义编辑器只按 `id` + `enabled` 决定区块显隐（详情页的社区区块、控制台的子系统面板）。

## 已退役

**运行时模块开关已随子系统拆分退役**：能力不是开关，是"这个服务有没有部署"。
因此不再有 `PUT /api/admin/modules/:id`（此前那个恒返回 409 的墓碑端点已整体删除），
请求该路径就是普通 404；调用方要开能力，就去部署对应服务。

> 历史背景与拆分决议见 [多项目解耦审计](./decoupling-audit-2026-09.md)（该文是历史快照）。
