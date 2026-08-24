# MetaFusion 编目 API 调用规范与自动化脚本模版 (API Reference & Templates)

本文档提供与 MetaFusion 编目与审核系统交互的标准 API 请求载荷与自动化 Python / Bash 脚本模版。

---

## 1. 认证与请求头标准

所有写操作均需携带个人访问令牌（PAT）或登录 JWT，并附带明确的 User-Agent 与 Content-Type：

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
      { "locale": "en-US", "title": "5 Centimeters per Second", "summary": "A tale of two people who were close friends..." }
    ]
  },
  "artists": [
    { "artist_id": "c1aebc99-9c0b-4ef8-bb6d-6bb9bd380a01", "role": "director" },
    { "artist_id": "c2aebc99-9c0b-4ef8-bb6d-6bb9bd380a02", "role": "composer" }
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
    { "medium_position": 1, "position": 1, "title": "第1话：樱花抄 (Cherry Blossom)", "duration": 1560 },
    { "medium_position": 1, "position": 2, "title": "第2话：宇航员 (Cosmonaut)", "duration": 1320 },
    { "medium_position": 1, "position": 3, "title": "第3话：秒速5厘米 (5 Centimeters per Second)", "duration": 900 }
  ],
  "edit_note": "Complete canonical work ingestion from CoMix Wave Films official archives",
  "source_urls": [
    "https://www.cwfilms.jp/5cm/"
  ]
}
```

### 2.2 跨媒介实体图谱拓扑更新 (`PUT /api/v1/catalog/entity-relations`)

用于连接世界观企划（Franchise）、作品（Work）与责任主体（Artist）之间的语义网络：

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
      "source_type": "work",
      "source_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "target_type": "work",
      "target_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "relationship_type": "adaptation_of",
      "qualifier": ""
    },
    {
      "source_type": "artist",
      "source_id": "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
      "target_type": "artist",
      "target_id": "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
      "relationship_type": "voice_actor_of",
      "qualifier": "ja"
    }
  ],
  "edit_note": "Link adaptation, soundtrack, and Japanese voice actor relations across movie franchise",
  "source_urls": [
    "https://vgmdb.net/album/5432",
    "https://www.animenewsnetwork.com/encyclopedia/anime.php?id=7890"
  ]
}
```

---

## 3. Python 自动化编目与质检 Agent 范式套件

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MetaFusion 权威编目审查与自动化入库脚本
"""
import os
import re
import requests

API_BASE = os.getenv("METAFUSION_API_BASE", "http://localhost:8080/api/v1")
API_TOKEN = os.getenv("METAFUSION_API_TOKEN", "")

HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "User-Agent": "MetaFusion-Archivist-Agent/1.0 (curator@metafusion.local)",
    "Content-Type": "application/json"
}

DIRTY_TITLE_PATTERNS = [
    r"TV(动画)?", r"剧场版", r"OVA", r"OAD", r"第[0-9一二三四]季",
    r"Season\s*\d+", r"Vol(ume)?\.\s*\d+", r"1080[pP]", r"4[kK]",
    r"UHD", r"Hi-Res", r"FLAC", r"初回限定", r"通常盘"
]

def validate_pure_title(title: str):
    """纯净题名审查"""
    for pat in DIRTY_TITLE_PATTERNS:
        if re.search(pat, title, re.IGNORECASE):
            raise ValueError(f"[QA REJECTED] Work title '{title}' contains dirty modifier matching pattern '{pat}'")

def validate_isbn13(isbn: str) -> bool:
    """ISBN-13 模 10 校验"""
    clean_isbn = re.sub(r"[-\s]", "", isbn)
    if len(clean_isbn) != 13 or not clean_isbn.isdigit():
        return False
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(clean_isbn[:12]))
    check_digit = (10 - (total % 10)) % 10
    return int(clean_isbn[12]) == check_digit

def search_and_verify_dedup(title: str):
    """防重检索"""
    resp = requests.get(f"{API_BASE}/search", params={"q": title, "type": "work"}, headers=HEADERS)
    resp.raise_for_status()
    data = resp.json()
    works = data.get("works", [])
    if works:
        print(f"[DEDUP] 发现已有作品: {works[0]['title']} (UUID: {works[0]['id']})")
        return works[0]
    return None

def submit_pure_work(payload: dict):
    """执行综合入库前置检验并提交"""
    assert "work" in payload, "Missing work block"
    assert "edit_note" in payload and len(payload["edit_note"].strip()) >= 10, "edit_note too short or missing"
    assert "source_urls" in payload and len(payload["source_urls"]) > 0, "Missing source_urls"
    
    # 纯净标题校验
    validate_pure_title(payload["work"].get("title", ""))
    
    # 封面比例校验
    aspect = payload["work"].get("cover_aspect")
    assert aspect in ["1:1", "2:3", "3:4"], f"Invalid cover_aspect: {aspect}"
    
    # ISBN 校验 (若存在)
    rel = payload.get("release", {})
    barcode = rel.get("barcode")
    if barcode and len(re.sub(r"[-\s]", "", barcode)) == 13:
        if not validate_isbn13(barcode):
            raise ValueError(f"[QA REJECTED] Invalid ISBN-13 checksum for barcode: {barcode}")
            
    resp = requests.post(f"{API_BASE}/catalog/submit", json=payload, headers=HEADERS)
    resp.raise_for_status()
    print("[SUCCESS] 编目实体创建成功:", resp.json())
    return resp.json()
```
