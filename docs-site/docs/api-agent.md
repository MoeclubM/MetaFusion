---
title: "Agent 接入"
description: "将 OpenAPI 作为 LLM 工具描述，批量编目的准则与示例。"
order: 36
group: "api"
---

# Agent 接入

MetaFusion 的开放 API 设计为 Agent 友好：稳定的 ID、可追溯的修订、显式的来源要求与 MusicBrainz 兼容的语义。

## 工具描述（喂给 LLM）

```json
{
  "tools": [
    { "name": "metafusion_search", "description": "Search works/artists/releases", "parameters": { "q": "string", "type": "work|artist|release|all" }, "endpoint": "GET /api/v1/search" },
    { "name": "metafusion_lookup_work", "description": "Lookup work with inc", "parameters": { "id": "uuid", "inc": "releases+relations" } },
    { "name": "metafusion_create_work", "description": "Create work (needs edit_note/source_urls)", "parameters": { "title": "string", "media_type": "string", "edit_note": "string", "source_urls": "string[]" } }
  ]
}
```

或直接拉取 `GET /api/v1/openapi.json` 作为工具集。

## Python 示例

```python
import requests
BASE = "https://your-host/api/v1"
H = {"Authorization": "Bearer mfp_...", "User-Agent": "MyAgent/1.0 (agent@example.com)", "Content-Type": "application/json"}

# 1. 搜索复用
r = requests.get(f"{BASE}/search", params={"q": "千与千寻", "type": "work"}, headers=H).json()
work_id = r["works"][0]["id"] if r.get("works") else None

# 2. 详情展开
work = requests.get(f"{BASE}/catalog/works/{work_id}", params={"inc": "releases+artists"}, headers=H).json()

# 3. 编辑（必须带 edit_note/source_urls）
requests.put(f"{BASE}/catalog/works/{work_id}", headers=H, json={
    "summary": "新概要",
    "edit_note": "agent enrichment from official site",
    "source_urls": ["https://example.com"]
})

# 4. 发帖
requests.post(f"{BASE}/community/topics", headers=H, json={
    "board_code": "general", "title": "考据笔记", "content": "来源：..."
})
```

## Agent 准则

- **每次写入必须带 `edit_note` 与 `source_urls`**（可追溯）
- **优先搜索复用现存实体**，避免重复创建；确需新建再 `POST /catalog/works`
- **遵守限流与 User-Agent**，批量任务间隔 ≥1s，`User-Agent` 需包含联系方式
- **尊重审核**：`pending` 内容仅作者/站务可见，不要绕过可见性过滤
- **媒体不爬**：预览/下载直链需认证，不要尝试未带 JWT 访问 `/storage/preview/*`

## 批量任务建议

- 使用 `page` / `page_size` 分页遍历，避免一次拉全量
- 对 `inc` 按需展开，减少 payload
- 失败重试时指数退避，429 时读取 `Retry-After`
