---
title: "编辑指南"
description: "如何新建与编辑 Work / Release / Artist，修订历史与合并。"
order: 20
group: "guide"
---

# 编辑指南

所有创建与编辑均需登录，自动写入 `entity_revisions`，与前端通用编辑器一致。

## 新建

```http
POST /api/v1/catalog/artists   { name, entity_type, biography, edit_note, source_urls }
POST /api/v1/catalog/works     { title, media_type, summary, cover_url, catalog_metadata, edit_note, source_urls }
POST /api/v1/catalog/releases  { work_id, edition_name, catalog_number, release_date, edit_note }
POST /api/v1/catalog/mediums   { release_id, position, name, format }
POST /api/v1/catalog/tracks    { medium_id, canonical_entry_id, position }
POST /api/v1/catalog/submit    # 一站式综合提交（Work+Release+Medium+Track+Relations）
```

**必填考据字段**：`edit_note`（本次编辑说明）与 `source_urls`（来源链接）。无此二者，审核可能被退回。

```bash
curl -X POST /api/v1/catalog/works \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"新作品","media_type":"anime","edit_note":"initial import","source_urls":["https://example.com"]}'
```

## 编辑

```http
PUT /api/v1/catalog/works/:id            { title?, summary?, cover_url?, edit_note, source_urls }
PUT /api/v1/catalog/artists/:id          { name?, biography?, edit_note }
PUT /api/v1/catalog/releases/:id         { edition_name?, edit_note }
PUT /api/v1/catalog/works/:id/relations  { relations: [{ target_type, target_id, relation_type, ... }] }
```

封面 URL 会经 `validateCoverURL` 校验，防止 SSRF 与非法外链。

## 一站式提交

`POST /catalog/submit` 适合详尽考据录入，一次提交 Work + Release + Medium + Track + 关系，服务端在事务中创建并记录修订。

## 修订历史

```http
GET /api/v1/catalog/revisions?target_type=work&target_id=:id
```

返回该实体的版本时间线，含 `before/after` 快照、`editor_id`、`edit_note`、`source_urls`。

## 合并

发现重复实体：

```http
POST /api/v1/catalog/merge
{ "source_type": "work", "source_id": "<dup>", "target_id": "<keep>", "edit_note": "merge duplicate per official site" }
```

- 需认证，自动迁移关联与修订，源实体标记为已合并。

## 成员级约束

- `Create*ForMember` 系列仅关联现有实体，不会以 `name` 兜底创建新 Artist/Work，避免脏数据。
- 角色需在 `validWorkRoles` 白名单内。

## 前端入口

- `/works/new`、`/releases/new`、`/artists/new`
- 作品/发行版/艺术家详情页的“编辑”按钮
- `/contribute` 统一投稿页（已重定向 `/upload` 与 `/submit`）

> 小技巧：先 `GET /search?q=...` 复用现存实体，再决定新建。批量任务间隔 ≥1s，遵守限流与 `User-Agent` 要求。
