#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MyGO!!!!! 全图谱重导 Phase D：书籍 works + LIVE 演出 works + 关系

书籍:
  漫画 530066 work[comic] + 单行本(1) 551652 release（subjects primary）
  指南书 497784 work[reference_book]（无 release，纯书目）
LIVE（work[concert] + release 影像盘口径 + performed_by）:
  主线 1st-8th: 492681/492680/492678/492677/492675/492657/505517/569750
  9th 本体+神戸再景合并: 613616 + 674571 -> 1 work 双 release
  ZEPP TOUR 2024/2025: 492671/569749
  12th LIVE DAY2: 492673
  合同 LIVE: 492483(Poppin'Party) / 502504(トゲナシトゲアリ) / 505568+573230(わかれ道 上海追加并入同 work 双 release) / 578285(moment/memory)
合作乐队 agent: トゲナシトゲアリ 65742（group）
拼盘/电台/出張版/新春会（11 条）不建 work。
"""
import json
import os
import re
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

# (主sid, work类型, [(release_sid, release备注)], 合作演出agent bgm key或None, 说明)
LIVES = [
    (492681, [(492681, "1st LIVE 影像")], None, "1st LIVE 僕たちはここで叫ぶ"),
    (492680, [(492680, "2nd LIVE 影像")], None, "2nd LIVE そのままを抱きしめて"),
    (492678, [(492678, "3rd LIVE 影像")], None, "3rd LIVE 声を抱えて生きる"),
    (492677, [(492677, "4th LIVE 影像")], None, "4th LIVE 前へ進む音の中で"),
    (492675, [(492675, "5th LIVE 影像")], None, "5th LIVE 迷うことに迷わない"),
    (492657, [(492657, "6th LIVE 影像")], None, "6th LIVE 見つけた景色、たずさえて"),
    (505517, [(505517, "7th LIVE 影像")], None, "7th LIVE こたえなんてなくても"),
    (569750, [(569750, "8th LIVE 影像")], None, "8th LIVE 想いのかたちが積もるとき"),
    (613616, [(613616, "9th LIVE 本体"), (674571, "9th LIVE 神戸再景編")], None, "9th LIVE つなぎ目の向こうに（双版本合并）"),
    (492671, [(492671, "ZEPP TOUR 2024 影像")], None, "ZEPP TOUR 2024 彷徨する渇望"),
    (569749, [(569749, "ZEPP TOUR 2025 影像")], None, "ZEPP TOUR 2025 心のはしを辿って"),
    (492673, [(492673, "12th LIVE DAY2 影像")], None, "12th LIVE DAY2 ちいさな一瞬"),
    (492483, [(492483, "合同 LIVE 影像")], "bgm:person:27251", "合同 Divide/Unite（Poppin'Party）"),
    (502504, [(502504, "合同 LIVE 影像")], "bgm:person:65742", "合同 Avoid Note（トゲナシトゲアリ）"),
    (505568, [(505568, "合同 LIVE 本体"), (573230, "上海追加公演")], "bgm:person:56638", "合同 わかれ道の、その先へ（双版本合并，Ave Mujica）"),
    (578285, [(578285, "ツーマン LIVE 影像")], "bgm:person:56638", "ツーマン moment/memory（Ave Mujica）"),
]


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


def create(token, state, bucket, key, entity, note, sources):
    if key in state.get(bucket, {}):
        return state[bucket][key]
    body = {"entity": entity, "expected_version": 0, "edit_note": note, "sources": sources}
    r = api("POST", "/catalog/entities", body, token)
    if r and r.get("id"):
        state.setdefault(bucket, {})[key] = r["id"]
        json.dump(state, open(STATE_FP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
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


def pic(subj, sid):
    img = ((subj.get("images") or {}).get("large") or "").split("?")[0]
    if not img:
        return []
    return [{"url": img,
             "caption": {"zh-CN": f"{subj['name']} 封面", "en-US": f"{subj['name']} cover"},
             "source": {"kind": "url", "citation": "Bangumi",
                        "url": f"https://bangumi.tv/subject/{sid}"}}]


def main():
    token = login()
    state = load(STATE_FP) if os.path.exists(STATE_FP) else {}
    agents = state.get("agents", {})
    mygo_group = agents.get("bgm:person:45638")
    assert mygo_group
    S = lambda u: [src(u, "Bangumi")]
    n_ok = n_fail = 0

    # 合作乐队 トゲナシトゲアリ
    if "bgm:person:65742" not in agents:
        p = load(f"{SURVEY}/persons/p_65742.json")
        ib = p.get("infobox") or []
        ent = {"kind": "agent", "title": p["name"], "original_language": "ja",
               "translations": {
                   "ja": {"title": p["name"], "summary": (p.get("summary") or "").strip(),
                          "aliases": aliases_of(ib, "纯假名", "日文漢字", "昵称")},
                   "zh-CN": {"title": "无刺有刺", "summary": "", "aliases": []},
                   "en-US": {"title": "TOGENASHI TOGEARI", "summary": "", "aliases": []}},
               "types": ["group"], "attributes": {},
               "external_ids": {"metafusion_import": "bgm:person:65742",
                                "bangumi_person": "65742"},
               "pictures": [{
                   "url": ((p.get("images") or {}).get("large") or "").split("?")[0],
                   "caption": {"zh-CN": "トゲナシトゲアリ 写真", "en-US": "TOGENASHI TOGEARI photo"},
                   "source": {"kind": "url", "citation": "Bangumi",
                              "url": "https://bangumi.tv/person/65742"}}],
               "status": "published"}
        nid = create(token, state, "agents", "bgm:person:65742", ent,
                     "重导合作乐队 トゲナシトゲアリ（Avoid Note 合同方）",
                     S("https://bangumi.tv/person/65742"))
        if nid:
            agents["bgm:person:65742"] = nid
        time.sleep(0.3)

    # ---- 书籍 ----
    manga = load(f"{SURVEY}/subj/s_530066.json")
    mwork = {"kind": "work", "title": manga["name"], "original_language": "ja",
             "translations": {
                 "ja": {"title": manga["name"], "summary": (manga.get("summary") or "").strip(),
                        "aliases": []},
                 "zh-CN": {"title": (manga.get("name_cn") or "").strip() or manga["name"],
                           "summary": (manga.get("summary") or "").strip(), "aliases": []}},
             "types": ["comic"], "attributes": {},
             "external_ids": {"metafusion_import": "bgm:subject:530066", "bangumi": "530066"},
             "pictures": pic(manga, 530066), "status": "published"}
    mwid = create(token, state, "works", "bgm:subject:530066", mwork,
                  "重导漫画 雨にそよいで晴れを請う：original_language=ja",
                  S("https://bangumi.tv/subject/530066"))
    time.sleep(0.3)
    if mwid:
        vol1 = load(f"{SURVEY}/subj/s_551652.json")
        vrel = {"kind": "release", "title": f"{vol1['name']}（单行本第1卷）",
                "original_language": "ja",
                "translations": {"ja": {"title": f"{vol1['name']}（单行本第1卷）",
                                        "summary": "", "aliases": []}},
                "types": ["release"],
                "attributes": {"country": "JP",
                               **({"edition_date": vol1["date"]} if re.match(r"^\d{4}-\d{2}-\d{2}$", vol1.get("date") or "") else {})},
                "external_ids": {"metafusion_import": "bgm:subject:551652:release"},
                "subjects": [{"work_id": mwid, "role": "primary", "position": 0}],
                "pictures": pic(vol1, 551652),
                "status": "published"}
        create(token, state, "releases", "bgm:subject:551652:release", vrel,
               "重导漫画单行本第1卷 release", S("https://bangumi.tv/subject/551652"))
        time.sleep(0.3)

    guide = load(f"{SURVEY}/subj/s_497784.json")
    gwork = {"kind": "work", "title": guide["name"], "original_language": "ja",
             "translations": {
                 "ja": {"title": guide["name"], "summary": (guide.get("summary") or "").strip(),
                        "aliases": []}},
             "types": ["reference_book"], "attributes": {},
             "external_ids": {"metafusion_import": "bgm:subject:497784", "bangumi": "497784"},
             "pictures": pic(guide, 497784), "status": "published"}
    create(token, state, "works", "bgm:subject:497784", gwork,
           "重导官方指南书 FOOTPRINTS：original_language=ja",
           S("https://bangumi.tv/subject/497784"))
    time.sleep(0.3)

    # ---- LIVE ----
    for main_sid, releases, partner_key, desc in LIVES:
        subj = load(f"{SURVEY}/subj/s_{main_sid}.json")
        name_ja = subj["name"]
        summary = (subj.get("summary") or "").strip()
        work = {"kind": "work", "title": name_ja, "original_language": "ja",
                "translations": {"ja": {"title": name_ja, "summary": summary, "aliases": []}},
                "types": ["concert"], "attributes": {},
                "external_ids": {"metafusion_import": f"bgm:subject:{main_sid}",
                                 "bangumi": str(main_sid)},
                "pictures": pic(subj, main_sid), "status": "published"}
        page = f"https://bangumi.tv/subject/{main_sid}"
        wid = create(token, state, "works", f"bgm:subject:{main_sid}", work,
                     f"重导演出 {name_ja}（{desc}）：original_language=ja", S(page))
        if not wid:
            continue
        print(f"WORK {main_sid} {name_ja[:40]}")
        time.sleep(0.3)
        pos = 0
        for rsid, rnote in releases:
            rsubj = load(f"{SURVEY}/subj/s_{rsid}.json")
            rdate = (rsubj.get("date") or "").strip()
            rattrs = {"country": "JP"}
            if re.match(r"^\d{4}-\d{2}-\d{2}$", rdate):
                rattrs["edition_date"] = rdate
            rel = {"kind": "release", "title": f"{rsubj['name']}（{rnote}）",
                   "original_language": "ja",
                   "translations": {"ja": {"title": f"{rsubj['name']}（{rnote}）",
                                           "summary": "", "aliases": []}},
                   "types": ["release"], "attributes": rattrs,
                   "external_ids": {"metafusion_import": f"bgm:subject:{rsid}:live-release"},
                   "subjects": [{"work_id": wid, "role": "primary", "position": pos}],
                   "pictures": pic(rsubj, rsid),
                   "status": "published"}
            create(token, state, "releases", f"bgm:subject:{rsid}:live-release", rel,
                   f"重导演出版本：{rnote}", S(f"https://bangumi.tv/subject/{rsid}"))
            pos += 1
            time.sleep(0.25)
        if relate(token, state, "performed_by", wid, mygo_group, {},
                  "演出：MyGO!!!!! performed_by", S(page)):
            n_ok += 1
        else:
            n_fail += 1
        if partner_key and partner_key in agents:
            if relate(token, state, "performed_by", wid, agents[partner_key], {},
                      "合同演出：合作方 performed_by", S(page)):
                n_ok += 1
            else:
                n_fail += 1
        time.sleep(0.3)

    print(f"\nPhase D done: relations ok={n_ok} fail={n_fail}")


if __name__ == "__main__":
    main()
