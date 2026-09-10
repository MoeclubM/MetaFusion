---
title: "新建与编辑"
description: "经 API 复现网页端全部编目能力：创建、编辑、关系与合并。"
order: 34
group: "api"
---

::: warning 文档与实现存在差异（一手提示）
本页绝大多数写入端点**不存在**。当前写入统一走通用实体端点：

- 不存在：`POST /api/catalog/{artists,works,canonical-entries,releases,mediums,tracks,franchises}`、`PUT /api/catalog/{works/:id,canonical-entries/:id,artists/:id,releases/:id}`、`PUT /api/catalog/works/:id/relations`、`PUT /api/catalog/entity-relations`、`POST /api/catalog/submit`、`POST /api/catalog/merge`
- 不存在：`GET /api/catalog/revisions?target_type=...`（真实为 `GET /api/catalog/entities/:id/revisions`）
- 不存在实体：`CanonicalEntry`（现为 `ContentUnit` + `Expression`）、`Artist`（现为 `Agent`）、`Franchise`（由 `collection` kind + 关系表达）

**真实写入端点**：`POST /api/catalog/entities`（创建，支持 `Idempotency-Key`）、`PUT /api/catalog/entities/:id`（整实体替换 + `expected_version` 乐观锁）、`POST /api/catalog/relations`、`PUT|DELETE /api/catalog/relations/:id`、`POST /api/catalog/entities/:id/lifecycle`（合并/退役，仅管理员）。请求体为 `{ entity: {...}, expected_version, edit_note, sources }`，不是逐实体扁平字段。
:::

# 新建与编辑

全部需认证，自动写入 `EntityRevision`，与前端通用编辑器一致。每次写入必须带 `edit_note` 与 `source_urls`。

## 新建（真实端点）

```http
POST /api/catalog/entities
{
  "entity": {
    "kind": "work",                 // agent | collection | work | content_unit | expression | release | medium | track
    "title": "攻壳机动队",
    "original_language": "ja",
    "translations": { "zh-CN": { "title": "攻壳机动队", "summary": "..." } },
    "types": ["..."],
    "attributes": { "cover_aspect": "2:3", "tags": ["动画", "电影"] },
    "external_ids": { "...": "..." },
    "pictures": [{ "url": "...", "source": { "kind": "official", "citation": "...", "url": "..." } }],
    "work_id": "<父 Work UUID>",     // content_unit / expression / release / medium / track 依层级填写
    "content_unit_id": "<UUID>",
    "release_id": "<UUID>",
    "medium_id": "<UUID>",
    "parent_id": "<同层父 UUID>",
    "position": 1,
    "number": "1",
    "contents": [{ "expression_id": "<UUID>", "position": 1, "locator": {} }],
    "subjects": [{ "work_id": "<UUID>", "role": "...", "position": 0 }]
  },
  "expected_version": 0,
  "edit_note": "initial import per official catalog",
  "sources": [{ "kind": "official", "citation": "...", "url": "https://example.com" }]
}
```

`translations` 是按 locale 分组的 **JSON 对象**（每个语种含 `title / summary / aliases`），**不是数组**。作品形态通过 `attributes` 中的标签与 `cover_aspect`（`"1:1"` / `"2:3"` / `"3:4"`）表达，无需 `media_type`。

## 编辑（真实端点）

```http
PUT /api/catalog/entities/:id
{
  "entity": { ...完整实体，保留所有无关字段... },
  "expected_version": 3,
  "edit_note": "fix typo per official site",
  "sources": [{ "kind": "official", "citation": "...", "url": "https://example.com" }]
}
```

PUT 是**整实体替换**而非局部 PATCH：必须先 GET 完整实体，按写入 DTO 保留无关字段（翻译、标签、Track contents 可能整组替换）。版本不匹配返回 409。

## 一站式提交

**当前无 `POST /api/catalog/submit`。** 复合结构需通过多次 `POST /api/catalog/entities`（按 `content_unit / expression` → `release` → `medium` → `track` 层级）+ `POST /api/catalog/relations` 组合完成；外部条目可用 `POST /api/importer/preview` 预览后 `POST /api/importer/import` 导入。

## 修订历史

```http
GET /api/catalog/entities/:id/revisions
```

## 合并

合并/退役不再有独立 `POST /api/catalog/merge`，统一走生命周期端点（管理员）。带 `target_id` 为合并，不带则为退役：

```http
POST /api/catalog/entities/:id/lifecycle
{ "target_id": "<keep>", "expected_version": 3, "edit_note": "merge duplicate", "sources": [] }
```

合并后源实体写入 `redirect_id`，可用 `GET /api/catalog/entities/:id/resolve` 解析到目标实体。

## 成员级约束

- 责任者通过 `agent` kind 实体 + `relations` 表达，不用 `Member` 概念
- 关系谓词须为 published definitions 中已启用的类型，目标 kind 受该谓词 `allowed_target_types` 约束
- `kind` 读 `/api/catalog/definitions`；不存在 `entity_type` / `validWorkRoles` 旧字段

## 示例

```bash
# 先读取完整实体，取回 version 后再整实体替换
curl "/api/catalog/entities/<id>" -b "mf_session=<cookie>"

curl -X PUT "/api/catalog/entities/<id>" \
  -H "Authorization: Bearer <session token>" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": { "id": "<id>", "kind": "work", "title": "修正标题", "translations": {}, "attributes": {} },
    "expected_version": 2,
    "edit_note": "fix typo per official site",
    "sources": [{ "kind": "official", "citation": "官网标题", "url": "https://example.com" }]
  }'
```
