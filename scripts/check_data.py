#!/usr/bin/env python3
"""MetaFusion 目录数据只读自检。

用途：把编目过程中反复靠人工 SQL/目视发现的问题固化成一条命令，便于定期跑或发布前核对。
只读：仅调用 GET /api/catalog/*，不写任何数据；对未登录可见性不足的项会如实标注"未检查"。

用法：
  python scripts/check_data.py                       # 默认查 https://findverse.cc
  BASE=https://example.org python scripts/check_data.py
  TOKEN=<bearer> python scripts/check_data.py        # 带上令牌可把草稿一并纳入

检查项：
  1. 发布态与翻译：published 但没有任何翻译记录的实体；
  2. 结构归属：definitions.structure 声明为 required 的结构字段为空；声明了 target_kinds 的字段指向了不匹配的层级；
  3. 图片：按层级的期望（work/release/agent/collection 至少一张；medium/track/expression 允许无图）统计缺图；
  4. 关系：端点不可见（指向已删/未发布）的边、同一 (type, source, target) 的重复边；
  5. 定义名称：仍等于英文（占位）的语种位。
退出码：0 = 无 P0/P1；1 = 存在 P0/P1。
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

BASE = os.environ.get("BASE", "https://findverse.cc").rstrip("/")
TOKEN = os.environ.get("TOKEN", "").strip()


def get(path, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url)
    # 网关/CDN 会拦默认 UA（Python-urllib → 403），带上可辨识的客户端标识。
    req.add_header("User-Agent", "MetaFusion-DataCheck/1.0 (+https://findverse.cc)")
    req.add_header("Accept", "application/json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def all_entities(kind=None, limit=50):
    # 服务端会夹住 limit（实测传 200 只回 50），所以按返回条数判断是否到底，不假设页大小。
    items, offset, page = [], 0, limit
    while True:
        params = {"limit": limit, "offset": offset}
        if kind:
            params["kind"] = kind
        data = get("/api/catalog/entities", params)
        batch = data.get("items") or []
        items.extend(batch)
        if len(batch) < page:
            return items
        offset += len(batch)


def main():
    problems = []
    stats = Counter()
    defs = get("/api/catalog/definitions")
    doc = defs.get("document") or defs
    relations = doc.get("relations") or {}
    structure = doc.get("structure") or {}

    entities = all_entities()
    stats["entities"] = len(entities)
    by_id = {e["id"]: e for e in entities}

    # 1. 发布态与翻译
    for e in entities:
        stats["kind:" + str(e.get("kind"))] += 1
        if e.get("status") == "published" and not (e.get("translations") or {}):
            problems.append(("P1", "published_without_translation", e["id"], e.get("title", "")))
    # 2. 结构归属（以 definitions.structure 为准，不写死层级）
    for e in entities:
        rule = structure.get(str(e.get("kind"))) or {}
        for f in rule.get("fields") or []:
            code = f.get("code")
            val = e.get(code)
            if f.get("required") and not val:
                problems.append(("P1", "structure_required_missing", e["id"], "%s.%s" % (e.get("kind"), code)))
            targets = f.get("target_kinds") or []
            if val and targets:
                tgt = by_id.get(val)
                if tgt is None:
                    problems.append(("P0", "structure_target_not_visible", e["id"], "%s.%s -> %s" % (e.get("kind"), code, val)))
                elif tgt.get("kind") not in targets:
                    problems.append(("P1", "structure_target_kind_mismatch", e["id"], "%s.%s -> %s(%s)" % (e.get("kind"), code, tgt.get("title"), tgt.get("kind"))))
    # 3. 图片（期望值按层级区分；medium/track/expression 允许无图）
    for e in entities:
        if e.get("kind") in ("work", "release", "agent", "collection") and not (e.get("pictures") or []):
            stats["no_picture"] += 1
            problems.append(("P2", "no_picture", e["id"], "%s/%s" % (e.get("kind"), e.get("title", ""))))
    # 4. 关系：重复边与端点不可见
    seen = defaultdict(int)
    checked = 0
    for e in entities:
        rel = get("/api/catalog/entities/%s/relations" % e["id"])
        items = rel.get("items") or []
        # 关系响应自带实体映射：端点可见性以它为准，不依赖全局列表是否分页完整。
        local_entities = rel.get("entities") or {}
        for r in items:
            # 一条边会在两端各出现一次：只在 source 端计数，避免把同一条边当成重复。
            if r.get("source_id") == e.get("id"):
                key = (r.get("type"), r.get("source_id"), r.get("target_id"))
                seen[key] += 1
                checked += 1
            for field in ("source_id", "target_id"):
                rid = r.get(field)
                if rid and rid not in local_entities and rid not in by_id:
                    problems.append(("P1", "relation_endpoint_not_visible", e["id"], "%s.%s -> %s" % (r.get("type"), field, rid)))
            if r.get("type") not in relations:
                problems.append(("P1", "relation_code_unknown", e["id"], str(r.get("type"))))
    stats["relation_edges_checked"] = checked
    for key, n in seen.items():
        if n > 1:
            problems.append(("P1", "duplicate_relation", key[0], "%s -> %s x%d" % (key[1], key[2], n)))
    # 5. 定义名称占位
    for section, bag in (("fields", doc.get("fields")), ("types", doc.get("types")), ("relations", relations)):
        for code, v in (bag or {}).items():
            names = (v or {}).get("names") or {}
            en = names.get("en-US")
            for loc in ("ja-JP", "zh-TW"):
                if names.get(loc) and en and names[loc] == en:
                    problems.append(("P2", "definition_name_placeholder", section + "." + code, loc))

    counts = Counter(p[0] for p in problems)
    print("自检目标: %s" % BASE)
    print("实体 %d（含草稿 %s），涉及关系边约 %d" % (stats["entities"], "是" if TOKEN else "否", stats["relation_edges_checked"]))
    print("问题分级: " + ", ".join("%s=%d" % (k, counts[k]) for k in ("P0", "P1", "P2") if counts[k]) or "无")
    by_kind = Counter(p[1] for p in problems)
    for name, n in by_kind.most_common():
        print("  %-34s %d" % (name, n))
    show = [p for p in problems if p[0] in ("P0", "P1")]
    if show:
        print("\nP0/P1 明细（最多 40 条）：")
        for lvl, name, ident, detail in show[:40]:
            print("  [%s] %-32s %s  %s" % (lvl, name, str(ident)[:12], detail[:80]))
    return 1 if counts["P0"] or counts["P1"] else 0


if __name__ == "__main__":
    sys.exit(main())