---
title: "新建与编辑"
description: "经 API 复现网页端全部编目能力：创建、编辑、关系与合并。"
order: 34
group: "api"
---

# 新建与编辑

全部需认证，自动写入 `EntityRevision`，与前端通用编辑器一致。每次写入必须带 `edit_note` 与 `source_urls`。

## 新建

```http
POST /api/v1/catalog/artists   { translations, language, entity_type, edit_note, source_urls }
POST /api/v1/catalog/works     { translations, language, tags, original_language, catalog_metadata, edit_note, source_urls }
POST /api/v1/catalog/releases  { work_id, edition_name, catalog_number, release_date, edit_note }
POST /api/v1/catalog/mediums   { release_id, position, name, format }
POST /api/v1/catalog/tracks    { medium_id, canonical_entry_id, position }
POST /api/v1/catalog/franchises { translations, language, aliases, edit_note, source_urls }
PUT  /api/v1/catalog/franchises/:id
PUT  /api/v1/catalog/entity-relations  { relations: [{ source_type, source_id, target_type, target_id, relationship_type, qualifier }] }
```

`translations` 为唯一多语言来源：`[{ locale, title|name, summary|biography }]`。`locale` 白名单：`zh-CN / zh-TW / en-US / ja / ko`。主表题名与简介等于 `language` 所指那一组。

作品形态由标签推断 `media_type`（如「电影」→ `movie`，「专辑」→ `music`），也可显式传入已启用的 `media_types.code`。

## 编辑

```http
PUT /api/v1/catalog/works/:id            { title?, summary?, cover_url?, edit_note, source_urls }
PUT /api/v1/catalog/artists/:id          { name?, biography?, edit_note }
PUT /api/v1/catalog/releases/:id         { edition_name?, catalog_number?, edit_note }
PUT /api/v1/catalog/works/:id/relations  { relations: [{ target_type, target_id, relation_type }] }
```

## 一站式提交

```http
POST /api/v1/catalog/submit
{
  "work": { "title": "...", "media_type": "anime" },
  "artists": [{ "artist_id": "...", "role": "director" }],
  "release": { "edition_name": "初回限定", "catalog_number": "VIZL-1" },
  "mediums": [{ "position": 1, "name": "Disc 1", "format": "BD" }],
  "tracks": [{ "medium_position": 1, "position": 1, "title": "Track 1" }],
  "edit_note": "import from official site",
  "source_urls": ["https://example.com"]
}
```

服务端在事务中创建全部实体，任一失败则回滚。

## 修订历史

```http
GET /api/v1/catalog/revisions?target_type=work&target_id=:id
GET /api/v1/catalog/revisions?target_type=artist&target_id=:id
GET /api/v1/catalog/revisions?target_type=franchise&target_id=:id
```

## 合并

```http
POST /api/v1/catalog/merge
{ "source_type": "work", "source_id": "<dup>", "target_id": "<keep>", "edit_note": "merge duplicate" }
```

自动迁移关联与资产，源实体标记为已合并。

## 成员级约束

- `Member` 角色仅可关联现有实体，不会以 `name` 兜底创建新实体
- `role` 须为 `relation_types` 中已启用、且 `allowed_target_types` 含 `work` 的谓词（不再使用硬编码 `validWorkRoles`）
- `entity_type` / `media_type` 读字典表；图谱端点为 `work | artist | release | franchise | canonical_entry`，同类多边用 `qualifier`

## 示例

```bash
curl -X PUT /api/v1/catalog/works/<id> \
  -H "Authorization: Bearer mfp_..." \
  -H "User-Agent: MyApp/1.0 (you@example.com)" \
  -H "Content-Type: application/json" \
  -d '{"title":"修正标题","edit_note":"fix typo per official site","source_urls":["https://example.com"]}'
```
