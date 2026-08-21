---
title: "分类 / 标签 / 货架 / 关系类型"
description: "Taxonomy 体系与 GET /catalog/taxonomy 的全量拉取。"
order: 11
group: "model"
---

# 分类 / 标签 / 货架 / 关系类型

## Taxonomy 全量接口

```http
GET /api/v1/catalog/taxonomy
GET /api/v1/catalog/categories
GET /api/v1/catalog/tags
GET /api/v1/catalog/shelves
GET /api/v1/catalog/relation-types
```

`GET /taxonomy` 一次返回：

- `categories`：层级分类（含本地化 `name`，按 `locale` 叠加）
- `shelves`：虚拟货架树（用于首页/探索的策展分区）
- `tags`：多维标签
- `media_types`：`movie / tv_series / anime / music / audiobook / novel / comic / gallery`
- `roles`：演职角色字典
- `formats / specs`：载体格式与物理规格（HDR/杜比/无损/CUE 等）

## 使用建议

- **筛选作品**：`GET /catalog/works?category=<code>&tag=<tag>&shelf=<shelf>&media_type=music`
- **Browse**：`GET /browse/works?artist=<id>&tag=<tag>&category=<code>&inc=artists`
- **本地化**：`?locale=zh-CN` 仅影响展示，不影响可见性

## 关系类型（动态）

由后台 `relation_types` 表驱动，支持如：

- 人 ↔ 作品：作曲、作词、演唱、编曲、导演、原作、声优
- 作品 ↔ 作品：改编、续作、前传、关联
- 艺术家 ↔ 艺术家：成员、别名、协作

通过 `PUT /catalog/works/:id/relations` 批量 Upsert，Member 级仅关联现有实体，不做 name 兜底创建（避免脏数据）。

## 探索页映射

前端 `/explore` 的筛选器直接映射到 `ListWorks` 的查询参数：

| UI 控件 | API 参数 |
|---|---|
| 媒介大类 | `media_type` |
| 分类 | `category` |
| 标签 | `tag` |
| 货架 | `shelf` |
| 语言 | `language` |
| 排序 | `sort=created_at/view_count/title` + `order=asc/desc` |
| 分页 | `page / page_size` (max 100) |

> 若需新增分类/标签/关系类型，请联系站务或在社区提案，审核后全站生效。
