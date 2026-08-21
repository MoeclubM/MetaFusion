---
title: "FRBR 五级模型"
description: "Work → Release → Medium → Track → Asset 的图书馆级编目结构。"
order: 10
group: "model"
---

# FRBR 五级模型

MetaFusion 采用图书馆学 FRBR（Functional Requirements for Bibliographic Records）思想，针对多媒介典藏扩展为五级：

```
Work（作品） ── 抽象的创作概念，如《攻壳机动队》
  └─ Release（发行版） ── 某次出版/发行，如“1995 剧场版 BD”
       └─ Medium（载体） ── 载体单元，如 Disc 1 / Disc 2
            └─ Track（条目） ── 曲目/章节/分轨
                 └─ Asset（资产） ── 二进制文件与技术规格
```

## 各级职责

| 层级 | 含义 | 关键字段 | 举例 |
|---|---|---|---|
| Work | 抽象作品 | title, media_type, summary, cover_url | 攻壳机动队、千与千寻 |
| Release | 具体发行 | edition_name, catalog_number, release_date, barcode | VIZL-123 初回限定盘 |
| Medium | 物理/逻辑载体 | position, name, format (CD/BD/Vinyl/Digital) | Disc 1, Disc 2 |
| Track | 曲目/章节 | position, canonical_entry_id | Track 01 - 谣 |
| Asset | 文件 | s3_key, sha256, mime, technical_specs | FLAC 96kHz/24bit |

另有：

- **Artist**：创作者/机构，通过 `entity_relationships` 与 Work/Release 关联，支持角色（作曲/演唱/导演/原作等）
- **Category**：中图分类法 CLC 等层级分类树
- **Tag / Shelf**：多维标签与虚拟货架（用于探索页聚合）
- **CanonicalEntry**：曲目典范条目，跨发行复用

## inc 展开

`GET /catalog/works/:id?inc=releases+artists+relations+revisions`

- `inc=artists`：展开 ArtistRelations
- `inc=releases`：首 50 发行版
- `inc=relations`：关系图谱边
- `inc=revisions`：最近 20 条修订

与 MusicBrainz `inc` 语义对齐，空格或 `+` 分隔。

## 图谱

- `GET /catalog/works/:id/graph`：作品的知识图谱（节点/边）
- `GET /catalog/artists/:id/graph`：创作者图谱
- 前端在作品/艺术家详情页以可视化呈现协作网络。

## 审核与可见性

- Release/Medium/Track 的可见性受 `applyReleaseVisibility` / `applyWorkVisibility` 控制，未审核内容仅作者/站务可见。
- 所有写入记录 `entity_revisions`，支持按 `target_type/target_id` 回溯。

> 编辑时请先搜索复用现存 Work/Artist，避免重复创建。确需新建，务必填写 `edit_note` 与 `source_urls`。
