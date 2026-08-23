# MetaFusion 编目 API 调用规范与自动化脚本模版 (API Reference & Templates)

本文档提供与 MetaFusion 编目与审核系统交互的标准 API 请求载荷与自动化 Python / Bash 脚本模版。

---

## 1. 认证与请求头标准

所有写操作均需携带个人访问令牌（PAT）或用户 JWT，并附带明确的 User-Agent：

```http
Authorization: Bearer mfp_your_personal_access_token_here
User-Agent: MetaFusionCuratorBot/1.0 (archivist@metafusion.local)
Content-Type: application/json
```

---

## 2. 核心端点与 Payload 模版

### 2.1 完整一站式入库 (`POST /api/v1/catalog/submit`)

用于一次性原子化创建 Work、Release、Medium、Track、演职员与多语言翻译（任一步骤失败则整体回滚）：

```json
{
  "work": {
    "title": "秒速5厘米",
    "original_language": "ja",
    "cover_aspect": "2:3",
    "cover_image_url": "https://storage.metafusion.local/covers/5cm_official_poster.webp",
    "tags": ["动画", "电影", "爱情", "青春", "新海诚"],
    "translations": [
      { "locale": "zh-CN", "title": "秒速5厘米", "summary": "时间带着明显的恶意，从我的头顶流逝..." },
      { "locale": "zh-TW", "title": "秒速5公分", "summary": "時間帶著明顯的惡意，從我的頭頂流逝..." },
      { "locale": "ja", "title": "秒速5センチメートル", "summary": "どれほどの速さで生きれば、きみにまた会えるのか。" },
      { "locale": "en-US", "title": "5 Centimeters per Second", "summary": "A tale of two people, Taki and Akari, who were close friends..." }
    ]
  },
  "artists": [
    { "artist_id": "c1aebc99-9c0b-4ef8-bb6d-6bb9bd380a01", "role": "director" },
    { "artist_id": "c2aebc99-9c0b-4ef8-bb6d-6bb9bd380a02", "role": "music" }
  ],
  "release": {
    "edition_name": "国际典藏版蓝光光盘",
    "catalog_number": "CWBA-0005",
    "barcode": "4988104044952",
    "release_date": "2008-04-18",
    "country": "JPN",
    "packaging": "Digipak"
  },
  "mediums": [
    {
      "position": 1,
      "name": "Disc 1 (Feature & Soundtracks)",
      "format": "Blu-ray"
    }
  ],
  "tracks": [
    { "medium_position": 1, "position": 1, "title": "第1话：樱花抄 (Cherry Blossom)" },
    { "medium_position": 1, "position": 2, "title": "第2话：宇航员 (Cosmonaut)" },
    { "medium_position": 1, "position": 3, "title": "第3话：秒速5厘米 (5 Centimeters per Second)" }
  ],
  "edit_note": "Complete canonical work ingestion from CoMix Wave Films official archives",
  "source_urls": [
    "https://www.cwfilms.jp/5cm/"
  ]
}
```

### 2.2 批量更新实体关系拓扑 (`PUT /api/v1/catalog/entity-relations`)

```json
{
  "relations": [
    {
      "source_type": "work",
      "source_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "target_type": "work",
      "target_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "relationship_type": "soundtrack_of",
      "qualifier": ""
    },
    {
      "source_type": "artist",
      "source_id": "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      "target_type": "work",
      "target_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "relationship_type": "composer",
      "qualifier": ""
    }
  ],
  "edit_note": "Link composer and soundtrack relation between album work and movie work",
  "source_urls": ["https://vgmdb.net/album/5432"]
}
```

### 2.3 重复实体安全合并 (`POST /api/v1/catalog/merge`)

```json
{
  "source_type": "work",
  "source_id": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "target_id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "edit_note": "Merge redundant dirty-title work into authoritative canonical work",
  "source_urls": ["https://bgm.tv/subject/12345"]
}
```

---

## 3. Python 自动化编目与质检 Agent 示例

```python
import os
import sys
import requests

API_BASE = os.getenv("METAFUSION_API_BASE", "http://localhost:8080/api/v1")
API_TOKEN = os.getenv("METAFUSION_API_TOKEN", "")

HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "User-Agent": "MetaFusion-Archivist-Agent/1.0 (curator@metafusion.local)",
    "Content-Type": "application/json"
}

def search_and_verify_dedup(title: str):
    """防重检索"""
    resp = requests.get(f"{API_BASE}/search", params={"q": title, "type": "work"}, headers=HEADERS)
    resp.raise_for_status()
    data = resp.json()
    works = data.get("works", [])
    if works:
        print(f"[DEDUP] Found existing work: {works[0]['title']} ({works[0]['id']})")
        return works[0]
    return None

def submit_pure_work(payload: dict):
    """校验必须字段并一站式提交"""
    assert "work" in payload, "Missing work block"
    assert "edit_note" in payload and payload["edit_note"].strip(), "Missing edit_note"
    assert "source_urls" in payload and len(payload["source_urls"]) > 0, "Missing source_urls"
    
    # 纯净标题校验
    dirty_keywords = ["TV动画", "第1季", "Season", "1080P", "BDrip", "Vol."]
    title = payload["work"].get("title", "")
    for kw in dirty_keywords:
        if kw.lower() in title.lower():
            raise ValueError(f"Work title contains dirty modifier '{kw}': {title}")
            
    # 封面比例校验
    aspect = payload["work"].get("cover_aspect")
    assert aspect in ["1:1", "2:3", "3:4"], f"Invalid cover_aspect: {aspect}"
    
    resp = requests.post(f"{API_BASE}/catalog/submit", json=payload, headers=HEADERS)
    resp.raise_for_status()
    print("[SUCCESS] Successfully submitted pure catalog work:", resp.json())
    return resp.json()

if __name__ == "__main__":
    print("MetaFusion Cataloging Agent Engine initialized.")
```
