#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MyGO 重导补丁：release 补 pictures（取所属 work 首图），PUT 全量回写保留无关字段。"""
import glob
import json
import os
import ssl
import sys
import time
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

VERIFY = "C:/Users/QwQ/AppData/Local/Temp/mygo_verify"
BASE_URL = os.getenv("MF_BASE", "https://findverse.cc/api")
USERNAME = os.getenv("MF_USER", "MoeCaa")
PASSWORD = os.getenv("MF_PASS", "")
if not PASSWORD:
    raise SystemExit("MF_PASS env required")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def api(method, path, body=None, token=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json", "User-Agent": "MetaFusion-MyGO-Reimport/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}")
        return None


token = api("POST", "/auth/login", {"username": USERNAME, "password": PASSWORD})["token"]

ents = []
for f in glob.glob(f"{VERIFY}/p_*.json"):
    with open(f, encoding="utf-8") as fh:
        ents.extend(json.load(fh).get("items", []))
by_id = {e["id"]: e for e in ents}

ok = fail = skip = 0
for e in ents:
    if e["kind"] != "release" or e.get("pictures"):
        continue
    wimg = None
    for s in e.get("subjects") or []:
        w = by_id.get(s.get("work_id"))
        if w and w.get("pictures"):
            wimg = w["pictures"][0]
            break
    if not wimg:
        print(f"SKIP (no source img): {e['title'][:40]}")
        skip += 1
        continue
    # 回读最新版本后全量 PUT
    cur = api("GET", f"/catalog/entities/{e['id']}", token=token)
    if not cur:
        fail += 1
        continue
    cur["pictures"] = [wimg]
    body = {"entity": cur, "expected_version": cur["version"],
            "edit_note": f"补发行版封面：沿用所属作品《{(by_id.get((e.get('subjects') or [{}])[0].get('work_id')) or {}).get('title', '')}》官方封面",
            "sources": [{"kind": "url", "citation": "Bangumi",
                         "url": wimg.get("source", {}).get("url", "https://bangumi.tv") if isinstance(wimg.get("source"), dict) else "https://bangumi.tv"}]}
    r = api("PUT", f"/catalog/entities/{e['id']}", body, token)
    if r and r.get("id"):
        ok += 1
        print(f"  OK {e['title'][:40]}")
    else:
        fail += 1
    time.sleep(0.3)
print(f"\npatch done: ok={ok} fail={fail} skip={skip}")
