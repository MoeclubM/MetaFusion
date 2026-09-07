#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MyGO!!!!! (Bangumi person/45638) 全图谱重导脚本
Phase A: agent x11（乐队 group + 声优 person x5 + 角色 character x5）

幂等键: external_ids['metafusion_import'] = 'bgm:person:{id}' / 'bgm:character:{id}'
多语言: title=日文原名, original_language=ja,
  translations.ja{原名, BGM summary, 日文别名}, zh-CN{简中名, 中文简介, 中文别名}, en-US{罗马字}
审计: 每写带 edit_note + source_urls
"""
import json
import os
import ssl
import sys
import time
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SURVEY = "C:/Users/QwQ/AppData/Local/Temp/mygo_survey"
BASE_URL = os.getenv("MF_BASE", "https://findverse.cc/api")
USERNAME = os.getenv("MF_USER", "MoeCaa")
PASSWORD = os.getenv("MF_PASS", "")
if not PASSWORD:
    raise SystemExit("MF_PASS env required (admin password for import run)")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

STATE_FP = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".mygo_reimport_state.json")


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


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
        err = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code}: {err[:400]}")
        return None


def login():
    r = api("POST", "/auth/login", {"username": USERNAME, "password": PASSWORD})
    if not r or "token" not in r:
        raise RuntimeError("login failed")
    print(f"logged in as {r['user']['username']} ({r['user']['role']})")
    return r["token"]


def find_existing(token, import_key):
    r = api("GET", f"/catalog/entities?field=external_ids.metafusion_import&value={import_key}&limit=5",
            token=token)
    items = (r or {}).get("items", [])
    return items[0] if items else None


def save_entity(token, entity, note, sources):
    body = {"entity": entity, "expected_version": 0, "edit_note": note, "sources": sources}
    return api("POST", "/catalog/entities", body, token)


def src(url, citation):
    return {"kind": "url", "citation": citation, "url": url}


def aliases_of(infobox, *kinds):
    out = []
    for b in infobox or []:
        if b.get("key") == "别名":
            v = b.get("value")
            items = v if isinstance(v, list) else [{"v": v}]
            for it in items:
                if isinstance(it, dict) and it.get("k") in kinds and it.get("v"):
                    out.append(it["v"])
    return out


def cn_name_of(infobox):
    for b in infobox or []:
        if b.get("key") == "简体中文名" and b.get("value"):
            return b["value"] if isinstance(b["value"], str) else None
    return None


def build_agent(person, type_code, extra_trans=None):
    """person: BGM person JSON；character 另行处理（字段相同）"""
    pid = person["id"]
    name_ja = person["name"]
    ib = person.get("infobox") or []
    cn = cn_name_of(ib)
    romaji = aliases_of(ib, "罗马字")
    en_name = aliases_of(ib, "英文名")
    ja_aliases = aliases_of(ib, "纯假名", "日文名", "昵称")
    summary = (person.get("summary") or "").strip()
    img = ((person.get("images") or {}).get("large") or "").split("?")[0]

    is_char = str(person.get("type")) == "character" or type_code == "character"
    bgm_kind = "character" if is_char else "person"
    translations = {
        "ja": {"title": name_ja, "summary": summary, "aliases": ja_aliases},
        "zh-CN": {"title": cn or name_ja, "summary": summary, "aliases": []},
    }
    en_title = (romaji + en_name)
    if en_title:
        translations["en-US"] = {"title": en_title[0], "summary": "", "aliases": en_title[1:]}
    if extra_trans:
        translations.update(extra_trans)

    entity = {
        "kind": "agent",
        "title": name_ja,
        "original_language": "ja",
        "translations": translations,
        "types": [type_code],
        "attributes": {},
        "external_ids": {
            "metafusion_import": f"bgm:{bgm_kind}:{pid}",
            f"bangumi_{bgm_kind}": str(pid),
        },
        "pictures": [],
        "status": "published",
    }
    if img:
        entity["pictures"].append({
            "url": img,
            "caption": {"zh-CN": f"{name_ja} 照片", "en-US": f"{name_ja} photo"},
            "source": {"kind": "url", "citation": "Bangumi",
                       "url": f"https://bangumi.tv/{bgm_kind}/{pid}"},
        })
    return entity


def main():
    token = login()
    state = load(STATE_FP) if os.path.exists(STATE_FP) else {}
    if "agents" not in state:
        state["agents"] = {}

    jobs = []
    # 乐队本体
    mygo = load(f"{SURVEY}/person_45638.json")
    jobs.append((mygo, "group", "https://bangumi.tv/person/45638",
                 "重导 MyGO!!!!! 乐队主体：设 original_language=ja，日文原名为主标题，简中/罗马字进 translations"))
    # 声优 5 人
    for pid in [40794, 53240, 42304, 53241, 32434]:
        p = load(f"{SURVEY}/persons/p_{pid}.json")
        jobs.append((p, "person", f"https://bangumi.tv/person/{pid}",
                     f"重导声优 {p['name']}：original_language=ja，多语言对齐"))
    # 角色 5 人
    for cid in [127790, 127791, 127792, 127793, 127794]:
        c = load(f"{SURVEY}/chars/c_{cid}.json")
        c = dict(c)
        c["type"] = "character"
        jobs.append((c, "character", f"https://bangumi.tv/character/{cid}",
                     f"重导角色 {c['name']}：类型 character，多语言对齐"))

    ok, skipped, failed = 0, 0, 0
    for person, type_code, page_url, note in jobs:
        key = f"bgm:{'character' if type_code == 'character' else 'person'}:{person['id']}"
        if key in state["agents"]:
            print(f"SKIP {person['name']} (already {state['agents'][key][:8]})")
            skipped += 1
            continue
        if find_existing(token, key):
            print(f"SKIP {person['name']} (exists online)")
            skipped += 1
            continue
        entity = build_agent(person, type_code)
        print(f"CREATE [{type_code}] {person['name']} ...")
        r = save_entity(token, entity, note, [src(page_url, "Bangumi")])
        if r and r.get("id"):
            state["agents"][key] = r["id"]
            json.dump(state, open(STATE_FP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print(f"  OK {r['id']}")
            ok += 1
        else:
            print(f"  FAILED {person['name']}")
            failed += 1
        time.sleep(0.5)
    print(f"\nPhase A done: ok={ok} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    main()
