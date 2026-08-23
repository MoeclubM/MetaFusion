---
title: "AI Agent 接入与自动化编目准则"
description: "面向 LLM / AI 代理的 OpenAPI 工具定义、标准编目 SOP、纯净实体准则与自动化审查规程。"
order: 36
group: "api"
---

# AI Agent 接入与自动化编目准则

MetaFusion 开放 API 专为自动化考据与 AI Agent 协同设计。为了保障数据纯净度、图谱拓扑一致性与版本可追溯性，所有接入 MetaFusion 的 AI Agent 必须严格遵守本项目内置的 **[MetaFusion Curator 编目审查技能包](/.cursor/skills/metafusion-curator/SKILL.md)**。

---

## 1. 核心接入规范与最高法则

1. **纯净实体原则 (Pure Entity Rule)**：
   - 创建或编辑 `Work` 逻辑作品时，`title` 必须保持最纯净的原作题名，**绝对禁止**混入季数（如“第1季”）、载体介质（如“TV动画”、“单行本”）、规格画质（如“1080P”、“Hi-Res”）或压制字幕组修饰词。
   - 所有出版规格、分卷分季、ISBN-13 与唱片编号必须归属于 `Release` 发行版与 `Medium` / `Track` 容器。
2. **每次写入必带审计信息**：
   - 每次调用写入/更新 API，必须在 payload 中携带明确具体的 `edit_note`（修订动机说明）与可访问核验的 `source_urls`（权威考据源列表）。
3. **检索查重优先 (Search & Deduplication First)**：
   - 严禁盲目直接创建。必须先调用 `GET /api/v1/search` 检索库内现有实体，优先复用或合并。
4. **封面规范与真实性**：
   - 封面比例严格按照 `cover_aspect` 执行（音乐 `1:1`、影视/动画 `2:3`、书籍/漫画 `3:4`），且必须为官方原厂出品，禁止占位图。

---

## 2. LLM 工具定义描述 (Tool Declarations)

可直接拉取 `GET /api/v1/openapi.json`，或向 LLM 注入以下原子与一站式编目工具：

```json
{
  "tools": [
    {
      "name": "metafusion_search",
      "description": "Search works, artists, releases, and franchises in MetaFusion for deduplication and lookup",
      "parameters": {
        "type": "object",
        "properties": {
          "q": { "type": "string", "description": "Search query keywords" },
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
          "inc": { "type": "string", "description": "Includes: releases+artists+relations+translations" }
        },
        "required": ["id"]
      }
    },
    {
      "name": "metafusion_submit_catalog",
      "description": "Atomically submit a pure Work along with Release, Mediums, Tracks, Artists, and Translations",
      "parameters": {
        "type": "object",
        "properties": {
          "work": {
            "type": "object",
            "properties": {
              "title": { "type": "string", "description": "Pure entity title (NO season, format, or resolution)" },
              "original_language": { "type": "string" },
              "cover_aspect": { "type": "string", "enum": ["1:1", "2:3", "3:4"] },
              "cover_image_url": { "type": "string" },
              "tags": { "type": "array", "items": { "type": "string" } },
              "translations": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "locale": { "type": "string" },
                    "title": { "type": "string" },
                    "summary": { "type": "string" }
                  }
                }
              }
            },
            "required": ["title", "cover_aspect"]
          },
          "release": { "type": "object" },
          "mediums": { "type": "array" },
          "tracks": { "type": "array" },
          "artists": { "type": "array" },
          "edit_note": { "type": "string", "description": "Detailed explanation of this cataloging submission" },
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
                "source_type": { "type": "string" },
                "source_id": { "type": "string" },
                "target_type": { "type": "string" },
                "target_id": { "type": "string" },
                "relationship_type": { "type": "string" },
                "qualifier": { "type": "string" }
              }
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

## 3. Python 编目与质检 Agent 完整示例

```python
import os
import requests

API_BASE = "https://your-metafusion-instance.org/api/v1"
HEADERS = {
    "Authorization": "Bearer mfp_your_token_here",
    "User-Agent": "MetaFusion-Curator-Agent/1.0 (agent@example.org)",
    "Content-Type": "application/json"
}

def curate_anime_movie():
    # 1. 查重检索
    q_resp = requests.get(f"{API_BASE}/search", params={"q": "攻壳机动队", "type": "work"}, headers=HEADERS).json()
    if q_resp.get("works"):
        print(f"Work already exists: ID={q_resp['works'][0]['id']}")
        return

    # 2. 一站式纯净入库
    payload = {
        "work": {
            "title": "攻壳机动队",
            "original_language": "ja",
            "cover_aspect": "2:3",
            "cover_image_url": "https://storage.metafusion.local/covers/gits_1995.webp",
            "tags": ["动画", "电影", "科幻", "赛博朋克"],
            "translations": [
                { "locale": "zh-CN", "title": "攻壳机动队", "summary": "公元2029年，网络高度发达的信息化时代..." },
                { "locale": "en-US", "title": "Ghost in the Shell", "summary": "A cyborg policewoman and her partner hunt a mysterious hacker..." },
                { "locale": "ja", "title": "GHOST IN THE SHELL / 攻殻機動隊", "summary": "西暦2029年。情報化の進展と同調して..." }
            ]
        },
        "artists": [
            { "artist_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "role": "director" }
        ],
        "release": {
            "edition_name": "4K UHD 典藏限量铁盒版",
            "catalog_number": "BCQA-0001",
            "barcode": "4934569363015",
            "release_date": "2018-06-22",
            "country": "JPN",
            "packaging": "Steelbook"
        },
        "mediums": [
            { "position": 1, "name": "Disc 1 (4K UHD)", "format": "UHD-BD" }
        ],
        "tracks": [
            { "medium_position": 1, "position": 1, "title": "Main Feature" }
        ],
        "edit_note": "Authoritative import from Bandai Visual catalog and official archives",
        "source_urls": ["https://v-storage.bnarts.jp/sp-site/ghost-in-the-shell/"]
    }
    
    resp = requests.post(f"{API_BASE}/catalog/submit", json=payload, headers=HEADERS)
    resp.raise_for_status()
    print("Cataloged pure work successfully:", resp.json())

if __name__ == "__main__":
    curate_anime_movie()
```

---

## 4. 自动化巡检与错误自愈策略

- **429 Too Many Requests**：读取响应头 `Retry-After`，采用指数退避算法暂停后重试（建议 Agent 批量请求间隔 ≥ 1.0s）；
- **422 Unprocessable Entity (Dirty Title / Cyclic Relation)**：解析错误明细，自动清洗 Work 标题并剥离修饰词至 Release，或断开循环关系边后重新提交；
- **401/403 Forbidden**：检查 Personal Access Token 权限范围（需具备 `catalog:write` 权限），更新 Authorization 请求头。
