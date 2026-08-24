---
title: "AI Agent 自动化 API 与工具规范"
description: "面向 LLM / 智能体的 OpenAPI 工具定义、原子化与事务写入端点、质检拦截与自动化巡检规范。"
order: 36
group: "api"
---

# AI Agent 自动化 API 与工具规范 (AI Agent API & Tool Specs)

MetaFusion 开放 API 为大语言模型（LLM）与自动化 Agent 提供了结构化、原子化的编目写入端点。本规范提供标准 Function Calling / Tools JSON Schema 定义、原子写入端点规范以及错误自愈与安全红线。

> 💡 **全面协作指南**：如需了解 Agent 身份设定、7步 SOP、多作品盒装案例、录音母版复用与完整 Python / TypeScript 脚本，请参阅专栏文档 **[《AI Agent 接入与自动化编目协作指南》](/agent-integration)**。

---

## 1. 核心接入规范与最高红线

1. **纯净实体原则 (Pure Entity Rule)**：
   - 创建或编辑 `Work` 逻辑作品时，`title` 必须保持最纯净的原作题名，**绝对禁止**混入季数（如“第1季”）、载体介质（如“TV动画”、“单行本”）、规格画质（如“1080P”、“Hi-Res”）或压制字幕组修饰词。
   - 所有出版规格、分卷分季、ISBN-13 与唱片编号必须归属于 `Release` 发行版与 `Medium` / `Track` 容器。
2. **每次写入必带审计信息**：
   - 每次调用写入/更新 API，必须在 payload 中携带明确具体的 `edit_note`（修订动机说明，≥ 10 字符）与可访问核验的 `source_urls`（权威考据源列表）。
3. **检索查重优先 (Search & Deduplication First)**：
   - 严禁盲目直接创建。必须先调用 `GET /api/v1/search` 检索库内现有实体，优先复用或合并。
4. **封面规范与真实性**：
   - 封面比例严格按照 `cover_aspect` 执行（音乐 `1:1`、影视/动画 `2:3`、书籍/漫画 `3:4`），且必须为官方原厂出品，禁止占位图。

---

## 2. LLM 工具定义描述 (Tool Declarations / JSON Schema)

可直接拉取 `GET /api/v1/openapi.json`，或向 LLM 注入以下原子与一站式编目工具定义：

```json
{
  "tools": [
    {
      "name": "metafusion_search",
      "description": "Search works, artists, releases, and franchises in MetaFusion for deduplication and lookup",
      "parameters": {
        "type": "object",
        "properties": {
          "q": { "type": "string", "description": "Search query keywords or barcode" },
          "type": { "type": "string", "enum": ["work", "artist", "release", "franchise", "all"], "default": "all" }
        },
        "required": ["q"]
      }
    },
    {
      "name": "metafusion_lookup_work",
      "description": "Lookup full details of a Work including releases, artists, and relationships",
      "parameters": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "format": "uuid", "description": "Work UUID" },
          "inc": { "type": "string", "description": "Includes: releases+artists+relations+translations", "default": "releases+artists+relations+translations" }
        },
        "required": ["id"]
      }
    },
    {
      "name": "metafusion_submit_catalog",
      "description": "Atomically submit a pure Work along with Release, Mediums, Tracks, Artists, and Translations in a single ACID transaction",
      "parameters": {
        "type": "object",
        "properties": {
          "work": {
            "type": "object",
            "properties": {
              "title": { "type": "string", "description": "Pure entity title (NO season, format, or resolution)" },
              "original_language": { "type": "string", "description": "ISO 639-1 code (e.g. ja, zh, en)" },
              "cover_aspect": { "type": "string", "enum": ["1:1", "2:3", "3:4"] },
              "cover_image_url": { "type": "string", "description": "Direct URL to official cover hosted on object storage" },
              "tags": { "type": "array", "items": { "type": "string" } },
              "translations": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "locale": { "type": "string" },
                    "title": { "type": "string" },
                    "summary": { "type": "string" }
                  },
                  "required": ["locale", "title"]
                }
              }
            },
            "required": ["title", "cover_aspect", "original_language"]
          },
          "artists": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "artist_id": { "type": "string", "format": "uuid" },
                "role": { "type": "string", "description": "e.g. director, composer, author, illustrator" }
              },
              "required": ["artist_id", "role"]
            }
          },
          "release": {
            "type": "object",
            "properties": {
              "edition_name": { "type": "string" },
              "catalog_number": { "type": "string" },
              "barcode": { "type": "string", "description": "Valid ISBN-13 or EAN barcode" },
              "release_date": { "type": "string", "format": "date" },
              "country": { "type": "string" },
              "packaging": { "type": "string" }
            },
            "required": ["edition_name"]
          },
          "mediums": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "position": { "type": "integer" },
                "name": { "type": "string" },
                "format": { "type": "string", "enum": ["CD", "Vinyl", "Blu-ray", "UHD-BD", "DVD", "Paperback", "Hardcover", "Digital"] }
              },
              "required": ["position", "format"]
            }
          },
          "tracks": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "medium_position": { "type": "integer" },
                "position": { "type": "integer" },
                "title": { "type": "string" },
                "duration": { "type": "integer", "description": "Duration in seconds" },
                "canonical_entry_id": { "type": "string", "format": "uuid" }
              },
              "required": ["medium_position", "position", "title"]
            }
          },
          "edit_note": { "type": "string", "description": "Detailed explanation of this cataloging submission (>= 10 chars)" },
          "source_urls": { "type": "array", "items": { "type": "string" }, "description": "Authoritative evidence URLs" }
        },
        "required": ["work", "edit_note", "source_urls"]
      }
    },
    {
      "name": "metafusion_update_relations",
      "description": "Update semantic topology relationships between entities (DAG acyclic check enforced)",
      "parameters": {
        "type": "object",
        "properties": {
          "relations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "source_type": { "type": "string", "enum": ["work", "artist", "franchise"] },
                "source_id": { "type": "string", "format": "uuid" },
                "target_type": { "type": "string", "enum": ["work", "artist", "franchise"] },
                "target_id": { "type": "string", "format": "uuid" },
                "relationship_type": { "type": "string", "enum": ["part_of_franchise", "adaptation_of", "soundtrack_of", "sequel_of", "prequel_of", "spin_off_of", "crossover_with", "included_in", "voice_actor_of", "character_in"] },
                "qualifier": { "type": "string" }
              },
              "required": ["source_type", "source_id", "target_type", "target_id", "relationship_type"]
            }
          },
          "edit_note": { "type": "string" },
          "source_urls": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["relations", "edit_note", "source_urls"]
      }
    }
  ]
}
```

---

## 3. 核心写入端点规范

### 3.1 一站式原子入库 (`POST /api/v1/catalog/submit`)

支持在单次请求中原子性创建逻辑作品（Work）、物理发行版（Release）、介质容器（Medium）、分轨/单集（Track）、创作者演职绑定（Artist Relationships）与多语言翻译（Translations）。任何一个环节校验失败（如 ISBN 校验位错误、题名命中污染黑名单），整个事务自动回滚。

#### 请求示例

```http
POST /api/v1/catalog/submit HTTP/1.1
Host: api.metafusion.local
Authorization: Bearer mfp_your_personal_access_token
User-Agent: MetaFusionCuratorBot/1.0
Content-Type: application/json

{
  "work": {
    "title": "秒速5厘米",
    "original_language": "ja",
    "cover_aspect": "2:3",
    "cover_image_url": "https://storage.metafusion.local/covers/5cm_poster.webp",
    "tags": ["动画", "电影", "爱情", "青春", "新海诚"],
    "translations": [
      { "locale": "zh-CN", "title": "秒速5厘米", "summary": "时间带着明显的恶意，从我的头顶流逝..." },
      { "locale": "ja", "title": "秒速5センチメートル", "summary": "どれほどの速さで生きれば、きみにまた会えるのか。" },
      { "locale": "en-US", "title": "5 Centimeters per Second", "summary": "A tale of two people who were close friends..." }
    ]
  },
  "artists": [
    { "artist_id": "c1aebc99-9c0b-4ef8-bb6d-6bb9bd380a01", "role": "director" }
  ],
  "release": {
    "edition_name": "日本院线官方初版蓝光",
    "catalog_number": "CWBA-0005",
    "barcode": "4988104044952",
    "release_date": "2008-04-18",
    "country": "JPN",
    "packaging": "Digipak"
  },
  "mediums": [
    {
      "position": 1,
      "name": "Disc 1 (Feature)",
      "format": "Blu-ray"
    }
  ],
  "tracks": [
    { "medium_position": 1, "position": 1, "title": "第1话：樱花抄", "duration": 1560 },
    { "medium_position": 1, "position": 2, "title": "第2话：宇航员", "duration": 1320 },
    { "medium_position": 1, "position": 3, "title": "第3话：秒速5厘米", "duration": 900 }
  ],
  "edit_note": "根据 CoMix Wave Films 官方档案录入初版蓝光规格与分集分轨",
  "source_urls": [
    "https://www.cwfilms.jp/5cm/"
  ]
}
```

#### 成功响应 (`201 Created`)

```json
{
  "code": 201,
  "message": "Work and release cataloged successfully",
  "data": {
    "work_id": "7b8deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "release_id": "8c9deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6e",
    "revision_id": "9d0deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6f",
    "medium_count": 1,
    "track_count": 3
  }
}
```

---

## 4. 自动化巡检与错误自愈策略

| 状态码 | 错误类型 | 触发原因 | Agent 自动化自愈策略 |
|---|---|---|---|
| **422** | `DirtyTitleError` | Work 标题中包含“第1季”、“1080P”、“TV版”等修饰词 | 自动剥离污染词汇并移入 Release `edition_name`，重新提交 |
| **422** | `CyclicGraphError` | 实体拓扑关系形成环路（如 A 是 B 的续作，B 又被指向为 A 的续作） | 运行本地 DFS 环路检测，剔除冗余反向边，维持单向 DAG |
| **422** | `InvalidCoverAspect` | 图片实际宽高比与 `cover_aspect` 偏差 > 5% | 校正 `cover_aspect`（1:1 / 2:3 / 3:4）或更换官方正规海报 |
| **422** | `InvalidBarcode` | ISBN-13 模 10 校验位计算不匹配 | 重新比对权威出版库纠正条形码 |
| **422** | `MissingAuditInfo` | `edit_note` 缺失/过短（< 10 字）或 `source_urls` 为空 | 补充考据动机说明与至少一条官方权威源 URL |
| **429** | `RateLimitExceeded` | 触发调用频控 | 解析响应头 `Retry-After`，按指数退避暂停后重试 |
| **401 / 403** | `Unauthorized` | 令牌过期或缺少 `catalog:write` 权限 | 更新 PAT 访问令牌或申请提权 |

---

## 5. 相关指引

- [AI Agent 接入与自动化编目协作指南](/agent-integration)
- [权威编目与元数据审查准则](/curation-guide)
- [IFLA LRM 增强版实体模型](/frbr-model)
- [PAT 访问令牌与认证](/api-auth)
- [全文搜索与多维过滤 API](/api-search)
