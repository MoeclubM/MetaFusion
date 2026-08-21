---
title: "更新日志"
description: "文档站与平台的版本记录。"
order: 62
group: "meta"
---

# 更新日志

## 2026-08-21 — 文档站 v1.0

- 独立文档站 `docs-site` 上线（Next.js 14 standalone，独立于 `frontend` 与 `/admin`）
- 内容：概览、理念、快速开始、FRBR 五级、分类体系、编辑/投稿/上传、API 全教程（Auth/Lookup/Browse/Search/Edit/Storage/Agent）、社区、服务条款、隐私、版权、联系、FAQ
- 网关：`Nginx /docs` 代理至 `docs:3001`，`docker-compose` 新增 `docs` 服务
- 搜索：文档站内本地全文检索（标题+摘要），支持移动端抽屉

## 2026-08-20 — 需求确立

- `docs/requirements.md` 锁定“元数据开放、媒体受控”边界与两级可见性 L0/L1
- 纠偏“私库”表述，明确邀请为风控手段，可后台开关

## 2026-08 早期

- FRBR 编目、PB 级双轨存储、HLS/音频/图书转码、邀请链、Asynq Worker、ES 检索与 SQL 降级、PAT（`mfp_`）与 WS/2 兼容 API 落地

> 文档内容随主站版本同步更新，编辑请提 PR 至 `docs-site/content/docs/`。
