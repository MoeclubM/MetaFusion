---
title: "编目体系：标签 / 货架 / 封面 / 多语言"
description: "MetaFusion LRM 编目模型、多维标签体系、虚拟货架规则与多语言本地化体系。"
order: 11
group: "model"
---

# 编目体系：标签 / 货架 / 封面 / 多语言

MetaFusion 采用 **IFLA LRM 混合编目模型**。实体（Work / Release / Artist / Franchise）保持纯净标题与核心概念，形态与规格通过「**多维标签 + 虚拟货架 + Release 载体规格 + 实体图谱边**」自然表达，彻底淘汰了传统的硬编码 `media_type` 与僵化的单继承分类树。

---

## 1. 多维标签体系 (Tag Ontology)

标签是 MetaFusion 描述作品形态、风格、题材与媒介属性的核心载体，划分为清晰的分组类型（`group_type`）：

| 分组 (`group_type`) | 说明 | 示例 | 适用实体 |
|---|---|---|---|
| `format` | 作品宏观形态（替代旧 `media_type`） | 动画、电影、剧集、专辑、单曲、原声带、轻小说、漫画、画集、游戏 | Work |
| `medium` | 表现载体介质与形态 | 剧场版、TV动画、OVA、广播剧、分轨、网络连载 | Work |
| `genre` | 音乐/影视/文学流派风格 | J-Pop、Rock、Jazz、Cyberpunk、科幻、奇幻、悬疑、摇滚 | Work |
| `theme` | 作品主题与受众定位 | 校园、机甲、日常、治愈、后日谈、冒险 | Work |
| `general` | 自由通用标签 | 萌系、大奖得主、年度精选、现象级 | Work |
| `topic` | 社区专属话题标签 | 考据、技术交流、资源分享 | Topic |

> **注**：Release 规格（如 `4K UHD`、`Hi-Res FLAC`、`SACD`、`EPUB`）属于发行版与物理 Medium 属性，不再作为 Work 标签，避免概念层与实物层混淆。

---

## 2. 虚拟货架体系 (Virtual Shelves)

虚拟货架将作品分类从“死板的物理目录树”转变为“**活的动态规则筛选器**”。

### 2.1 规则机制
每个货架由一组标签规则定义：
- `query_tags`：包含的标签集合（如 `["动画", "电影"]` 或 `["Hi-Res", "爵士"]`）
- `require_all_tags`：`true` 表示必须同时满足全部标签（AND），`false` 表示满足任一标签（OR）
- `exclude_tags`：排除的标签集合（NOT）

### 2.2 用户自定义货架与频道
- 平台预设公共货架（如“剧场动画”、“无损专辑”、“精选小说”）；
- 用户可在个人首页自由新建、配置自定义货架，并支持拖拽排版与一键公开分享。

---

## 3. 封面自适应与多比例系统

MetaFusion 尊重各媒介载体的传统排版与艺术设计习惯，支持**自然宽高比自适应**与**精确比例控制**：

### 3.1 比例标准
- **方形 1:1**：音乐唱片、EP、原声大碟（OST）、单曲；
- **竖向海报 2:3**：电影、电视动画、真人剧集海报；
- **标准书页 3:4**：轻小说、单行本漫画、出版物、画集。

### 3.2 判定与覆盖机制
1. **手动指定**：作品表记录 `works.cover_aspect`（如 `"1:1"`、`"2:3"`、`"3:4"`）。当用户显式指定时，严格按照指定比例渲染；
2. **自动推断**：当 `cover_aspect` 为空时，前端根据作品的 `format` 标签自动推断典型比例；
3. **自适应渲染**：组件支持平滑过渡，并在占位符阶段根据比例提前布局，杜绝布局抖动（CLS）。

---

## 4. 多语言本地化体系 (Translations)

MetaFusion 具备完整的国际化编目支持，所有主实体均通过 `_translations` 表保存各语种译名与简介：

- **支持语种**：`zh-CN`（简体中文）、`zh-TW`（繁体中文）、`en-US`（英语）、`ja`（日语）、`ko`（韩语）等；
- **主表与回退链**：
  1. 主表的 `title` / `summary`（或 `name` / `biography`）作为默认语种基准；
  2. 请求时通过 `?locale=zh-CN` 指定偏好语言；
  3. 服务端/前端优先展示对应语种的精确翻译，未命中时回退到默认语种与原文标题。

---

## 5. API 接口与拉取

```http
GET /api/v1/catalog/taxonomy
GET /api/v1/catalog/tags?group_type=format
GET /api/v1/catalog/shelves
GET /api/v1/catalog/relation-types
```

### 5.1 作品列表筛选（ListWorks）
```http
GET /api/v1/catalog/works?shelf=anime-movies&tags=动画,电影&tag_match=all&language=zh-CN&sort=created_at&page=1&page_size=24
```

| 参数 | 说明 |
|---|---|
| `shelf` | 虚拟货架 Slug |
| `custom_shelf` | 用户自定义货架 UUID |
| `tags` / `tag` | 标签名称过滤（逗号分隔） |
| `tag_match` | 标签匹配模式：`all`（同时满足）/ `any`（满足其一） |
| `q` | 全文检索关键词 |
| `language` / `locale` | 语言过滤与本地化偏好 |
| `sort` | 排序字段：`created_at` / `view_count` / `title` / `release_date` |
| `page` / `page_size` | 分页参数（`page_size` 最大 100） |
