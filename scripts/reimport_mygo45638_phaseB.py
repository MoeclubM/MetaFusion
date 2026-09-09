#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MyGO!!!!! 全图谱重导 Phase B：动画 works + 分集 content_unit + 核心关系

work: TV 428735 / 剧场版前后篇 473832+473833 / 日常番 448391 / 续作 Ave Mujica 454684
content_unit: 各话（TV 14 + 日常番 48 + Ave Mujica 13 + 剧场版各1）
  -> content_unit 挂 work_id；expression 挂 content_unit_id（话母版）
agent: 吉祥物角色 MyGO!!!!! character/200841（日常番配角）
关系:
  角色 character_in 作品（5 主角 + 吉祥物）
  声优 voiced_by 作品 attributes.character=<角色agent id>（只建 MyGO 5 人，不碰客串声优）
  乐队 group character_in TV/剧场版/日常番（乐队整体登场）
  续作 Ave Mujica sequel_of TV（DAG 单向）；剧场版 adaptation_of TV
  歌曲 work insert_soundtrack 后续 Phase C 建
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
    raise SystemExit("MF_PASS env required")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FP = os.path.join(SCRIPT_DIR, ".mygo_reimport_state.json")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


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
        print(f"  HTTP {e.code}: {err[:300]}")
        return None


def login():
    r = api("POST", "/auth/login", {"username": USERNAME, "password": PASSWORD})
    if not r or "token" not in r:
        raise RuntimeError("login failed")
    return r["token"]


def src(url, citation):
    return {"kind": "url", "citation": citation, "url": url}


def aliases_of(infobox, *kinds):
    out = []
    for b in infobox or []:
        if b.get("key") == "别名":
            v = b.get("value")
            items = v if isinstance(v, list) else [{"v": v}]
            for it in items:
                if isinstance(it, dict):
                    if kinds and it.get("k") not in kinds:
                        continue
                    if it.get("v"):
                        out.append(it["v"])
                elif isinstance(it, str) and it:
                    out.append(it)
    return out


def build_work(subj, type_code):
    sid = subj["id"]
    name_ja = subj["name"]
    name_cn = (subj.get("name_cn") or "").strip()
    ib = subj.get("infobox") or []
    summary = (subj.get("summary") or "").strip()
    img = ((subj.get("images") or {}).get("large") or "").split("?")[0]
    translations = {"ja": {"title": name_ja, "summary": summary,
                           "aliases": aliases_of(ib, "纯假名", "日文名")}}
    if name_cn and name_cn != name_ja:
        translations["zh-CN"] = {"title": name_cn, "summary": summary, "aliases": []}
    entity = {
        "kind": "work",
        "title": name_ja,
        "original_language": "ja",
        "translations": translations,
        "types": [type_code],
        "attributes": {},
        "external_ids": {"metafusion_import": f"bgm:subject:{sid}", "bangumi": str(sid)},
        "pictures": [],
        "status": "published",
    }
    if img:
        entity["pictures"].append({
            "url": img,
            "caption": {"zh-CN": f"{name_ja} 封面", "en-US": f"{name_ja} cover"},
            "source": {"kind": "url", "citation": "Bangumi",
                       "url": f"https://bangumi.tv/subject/{sid}"},
        })
    return entity


def create(token, state, bucket, key, entity, note, sources):
    if key in state.get(bucket, {}):
        return state[bucket][key]
    body = {"entity": entity, "expected_version": 0, "edit_note": note, "sources": sources}
    r = api("POST", "/catalog/entities", body, token)
    if r and r.get("id"):
        state.setdefault(bucket, {})[key] = r["id"]
        json.dump(state, open(STATE_FP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  OK [{entity['kind']}] {entity['title'][:40]} {r['id'][:8]}")
        return r["id"]
    print(f"  FAILED [{entity['kind']}] {entity['title'][:40]}")
    return None


def relate(token, state, rel_type, src_id, tgt_id, attrs, note, sources):
    rkey = f"{rel_type}:{src_id[:8]}:{tgt_id[:8]}:{json.dumps(attrs, sort_keys=True, ensure_ascii=False)}"
    if rkey in state.get("relations", {}):
        return True
    body = {"relation": {"type": rel_type, "source_id": src_id, "target_id": tgt_id,
                         "position": 0, "attributes": attrs},
            "expected_version": 0, "edit_note": note, "sources": sources}
    r = api("POST", "/catalog/relations", body, token)
    if r and (r.get("id") or r.get("ok")):
        state.setdefault("relations", {})[rkey] = True
        json.dump(state, open(STATE_FP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return True
    return False


WORKS = [
    (428735, "animation", "TV 动画 BanG Dream! It's MyGO!!!!!（13 话+特番）"),
    (473832, "film", "剧场版前篇 春の陽だまり、迷い猫"),
    (473833, "film", "剧场版后篇 うたう、僕らになれるうた & FILM LIVE"),
    (448391, "animation", "WEB 泡面番 MyGO!!!!!メンバーの日常（48 话）"),
    (454684, "animation", "续作 TV BanG Dream! Ave Mujica（MyGO 世界观续篇）"),
]

CHAR_PAIRS = [(127790, 40794), (127791, 53240), (127792, 42304), (127793, 53241), (127794, 32434)]


def main():
    token = login()
    state = load(STATE_FP) if os.path.exists(STATE_FP) else {}
    agents = state.get("agents", {})
    mygo_group = agents.get("bgm:person:45638")
    char_ids = {c: agents.get(f"bgm:character:{c}") for c, _ in CHAR_PAIRS}
    seiyu_ids = {p: agents.get(f"bgm:person:{p}") for _, p in CHAR_PAIRS}
    assert mygo_group and all(char_ids.values()) and all(seiyu_ids.values()), "Phase A agents missing"

    # 吉祥物角色
    mascot = load(f"{SURVEY}/chars/c_200841.json")
    mascot_ent = {
        "kind": "agent", "title": "MyGO!!!!!", "original_language": "ja",
        "translations": {
            "ja": {"title": "MyGO!!!!!", "summary": (mascot.get("summary") or "").strip(),
                   "aliases": aliases_of(mascot.get("infobox"), "纯假名")},
            "zh-CN": {"title": "MyGO!!!!!", "summary": "", "aliases": []},
        },
        "types": ["character"], "attributes": {},
        "external_ids": {"metafusion_import": "bgm:character:200841", "bangumi_character": "200841"},
        "pictures": [{
            "url": ((mascot.get("images") or {}).get("large") or "").split("?")[0],
            "caption": {"zh-CN": "MyGO!!!!! 吉祥物形象", "en-US": "MyGO!!!!! mascot"},
            "source": {"kind": "url", "citation": "Bangumi",
                       "url": "https://bangumi.tv/character/200841"},
        }],
        "status": "published",
    }
    mascot_id = create(token, state, "agents", "bgm:character:200841", mascot_ent,
                       "重导吉祥物角色 MyGO!!!!!（日常番登场形象，区别于乐队主体）",
                       [src("https://bangumi.tv/character/200841", "Bangumi")])
    time.sleep(0.3)

    work_ids = {}
    for sid, tcode, desc in WORKS:
        subj = load(f"{SURVEY}/subj/s_{sid}.json")
        ent = build_work(subj, tcode)
        wid = create(token, state, "works", f"bgm:subject:{sid}", ent,
                     f"重导动画 {subj['name']}：original_language=ja，多语言对齐",
                     [src(f"https://bangumi.tv/subject/{sid}", "Bangumi")])
        work_ids[sid] = wid
        time.sleep(0.3)
    assert all(work_ids.values()), "work creation failed"

    # 分集 content_unit + 话母版 expression
    for sid in [428735, 473832, 473833, 448391, 454684]:
        tr = load(f"{SURVEY}/tracks/t_{sid}.json")
        wid = work_ids[sid]
        for ep in tr.get("data", []):
            sort = ep.get("sort", 0)
            title = ep.get("name_cn") or ep.get("name") or f"第{sort}话"
            key = f"bgm:subject:{sid}:ep:{sort}"
            cu = {
                "kind": "content_unit", "title": title, "original_language": "ja",
                "translations": {"ja": {"title": ep.get("name") or title, "summary": "",
                                        "aliases": []}},
                "types": ["content_unit"], "attributes": {},
                "external_ids": {"metafusion_import": key},
                "work_id": wid,
                "position": int(sort or 0),
                "status": "published",
            }
            if ep.get("name_cn") and ep["name_cn"] != ep.get("name"):
                cu["translations"]["zh-CN"] = {"title": ep["name_cn"], "summary": "",
                                               "aliases": []}
            cuid = create(token, state, "units", key, cu,
                          f"重导分集：{title}（Bangumi ep{sort}）",
                          [src(f"https://bangumi.tv/subject/{sid}", "Bangumi")])
            if cuid:
                ex = {
                    "kind": "expression", "title": f"{title}（母版）",
                    "original_language": "ja",
                    "translations": {"ja": {"title": f"{title}（母版）", "summary": "",
                                            "aliases": []}},
                    "types": ["expression"], "attributes": {},
                    "external_ids": {"metafusion_import": key + ":master"},
                    "work_id": wid, "content_unit_id": cuid,
                    "status": "published",
                }
                create(token, state, "expressions", key + ":master", ex,
                       f"重导话母版 expression：{title}",
                       [src(f"https://bangumi.tv/subject/{sid}", "Bangumi")])
            time.sleep(0.2)

    # ---- 关系 ----
    tv, pre, post, daily, mujica = (work_ids[s] for s in [428735, 473832, 473833, 448391, 454684])
    S = lambda u: [src(u, "Bangumi")]
    n_ok = n_fail = 0

    def edge(t, s, g, attrs, note, url):
        global_n = relate(token, state, t, s, g, attrs, note, S(url))
        return global_n

    for sid, wid in work_ids.items():
        url = f"https://bangumi.tv/subject/{sid}"
        # 5 主角 character_in + 声优 voiced_by（character=角色agent id）
        if sid in (428735, 473832, 473833, 448391):
            for cid, pid in CHAR_PAIRS:
                if edge("character_in", char_ids[cid], wid, {},
                        "角色登场：角色 agent character_in 作品", url):
                    n_ok += 1
                else:
                    n_fail += 1
                if edge("voiced_by", wid, seiyu_ids[pid], {"character": char_ids[cid]},
                        "配音：声优 voiced_by 作品（character 指向角色）", url):
                    n_ok += 1
                else:
                    n_fail += 1
        # 乐队整体登场
        if sid in (428735, 473832, 473833, 448391):
            if edge("character_in", mygo_group, wid, {}, "乐队整体登场", url):
                n_ok += 1
            else:
                n_fail += 1
        time.sleep(0.3)

    # 吉祥物登场日常番
    if mascot_id:
        if edge("character_in", mascot_id, daily, {}, "吉祥物形象登场日常番",
                "https://bangumi.tv/subject/448391"):
            n_ok += 1
        else:
            n_fail += 1
    # Ave Mujica：MyGO 五人配角登场 + 声优配音 + sequel_of TV
    for cid, pid in CHAR_PAIRS:
        if edge("character_in", char_ids[cid], mujica, {}, "MyGO 角色在续作中配角登场",
                "https://bangumi.tv/subject/454684"):
            n_ok += 1
        else:
            n_fail += 1
        if edge("voiced_by", mujica, seiyu_ids[pid], {"character": char_ids[cid]},
                "续作配音", "https://bangumi.tv/subject/454684"):
            n_ok += 1
        else:
            n_fail += 1
    if edge("character_in", mygo_group, mujica, {}, "乐队在续作世界观登场",
            "https://bangumi.tv/subject/454684"):
        n_ok += 1
    else:
        n_fail += 1
    if edge("sequel_of", mujica, tv, {}, "Ave Mujica 是 TV MyGO 的续作（DAG 单向）",
            "https://bangumi.tv/subject/454684"):
        n_ok += 1
    else:
        n_fail += 1
    # 剧场版 adaptation_of TV（总集+新作，按改编计）
    for rid, nm in ((pre, "前篇"), (post, "后篇")):
        if edge("adaptation_of", rid, tv, {}, f"剧场版{nm}改编自 TV（总集+新作）",
                "https://bangumi.tv/subject/428735"):
            n_ok += 1
        else:
            n_fail += 1

    print(f"\nPhase B done: relations ok={n_ok} fail={n_fail}")


if __name__ == "__main__":
    main()
