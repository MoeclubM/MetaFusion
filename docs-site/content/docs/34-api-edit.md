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
POST /api/v1/catalog/artists   { name, entity_type, biography, edit_note, source_urls }
POST /api/v1/catalog/works     { title, media_type, catalog_metadata, edit_note, source_urls }
POST /api/v1/catalog/releases  { work_id, edition_name, catalog_number, release_date, edit_note }
POST /api/v1/catalog/mediums   { release_id, position, name, format }
POST /api/v1/catalog/tracks    { medium_id, canonical_entry_id, position }
POST /api/v1/catalog/submit    # 一站式综合提交
```

`media_type` 可选：`movie / tv_series / anime / music / audiobook / novel / comic / gallery`

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
GET /api/v1/catalog/revisions?target_type=release&target_id=:id
```

## 合并

```http
POST /api/v1/catalog/merge
{ "source_type": "work", "source_id": "<dup>", "target_id": "<keep>", "edit_note": "merge duplicate" }
```

自动迁移关联与资产，源实体标记为已合并。

## 成员级约束

- `Member` 角色仅可关联现有实体，不会以 `name` 兜底创建新实体
- `role` 需在白名单 `validWorkRoles` 内

## 示例

```bash
curl -X PUT /api/v1/catalog/works/<id> \
  -H "Authorization: Bearer mfp_..." \
  -H "User-Agent: MyApp/1.0 (you@example.com)" \
  -H "Content-Type: application/json" \
  -d '{"title":"修正标题","edit_note":"fix typo per official site","source_urls":["https://example.com"]}'
```
